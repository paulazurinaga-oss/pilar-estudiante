const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { transcribeAudio } = require('./aiService');

const jobs = new Map();
const chunkDurationSeconds = 5 * 60;

function cleanJoinedTranscription(parts) {
  const seenParagraphs = new Set();
  const cleaned = [];

  for (const part of parts) {
    const withoutHeaders = part
      .replace(/^Aquí tienes la transcripción literal del audio,?[^\n]*:\s*/i, '')
      .replace(/^Aquí tienes la transcripción del audio,?[^\n]*:\s*/i, '')
      .trim();

    const paragraphs = withoutHeaders.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
    for (const paragraph of paragraphs) {
      const key = paragraph.toLocaleLowerCase('es');
      if (!seenParagraphs.has(key)) {
        seenParagraphs.add(key);
        cleaned.push(paragraph);
      }
    }
  }

  return cleaned.join('\n\n');
}

function createJob({ filePath, fileName, mimeType }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const job = {
    id,
    fileName,
    status: 'queued',
    progress: 0,
    completedChunks: 0,
    totalChunks: 0,
    text: '',
    error: null,
    pausedReason: null,
  };
  jobs.set(id, job);
  processJob(job, { filePath, mimeType }).catch((error) => {
    job.status = 'failed';
    job.error = error.message;
  });
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args, { windowsHide: true });
    let errorOutput = '';
    process.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `ffmpeg terminó con código ${code}.`));
    });
  });
}

async function processJob(job, { filePath, mimeType }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurapilar-transcription-'));
  const chunkPattern = path.join(workDir, 'chunk-%05d.mp3');
  job.status = 'processing';

  try {
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-i', filePath,
      '-vn', '-acodec', 'libmp3lame', '-f', 'segment',
      '-segment_time', String(chunkDurationSeconds), '-reset_timestamps', '1', chunkPattern,
    ]);

    const chunks = fs.readdirSync(workDir)
      .filter((fileName) => fileName.endsWith('.mp3'))
      .sort()
      .map((fileName) => path.join(workDir, fileName));

    if (!chunks.length) throw new Error('No se pudieron crear fragmentos de audio.');
    job.totalChunks = chunks.length;

    const transcriptions = new Array(chunks.length);

    async function processChunk(index) {
      const chunkPath = chunks[index];
      let result = null;
      let lastError = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        result = await transcribeAudio({
          fileName: `${job.fileName} - parte ${index + 1}`,
          buffer: fs.readFileSync(chunkPath),
          mimeType: 'audio/mpeg',
        });
        if (!result.fallback) break;
        lastError = result.error || 'El proveedor no devolvió una transcripción.';
        if (result.quotaExceeded) break;
      }

      if (!result || result.fallback) {
        if (result?.quotaExceeded) {
          job.status = 'paused_quota';
          job.pausedReason = 'Gemini agotó la cuota diaria. El audio y las partes ya procesadas se conservan.';
        }
        throw new Error(`Falló la parte ${index + 1}: ${lastError}`);
      }

      transcriptions[index] = result.text.trim();
      job.completedChunks += 1;
      job.progress = Math.round((job.completedChunks / job.totalChunks) * 100);
    }

    let nextIndex = 0;
    async function worker() {
      while (nextIndex < chunks.length) {
        const index = nextIndex;
        nextIndex += 1;
        await processChunk(index);
      }
    }

    await Promise.all([worker(), worker()]);

    job.text = cleanJoinedTranscription(transcriptions);
    job.status = 'completed';
    job.progress = 100;
  } catch (error) {
    if (job.status !== 'paused_quota') {
      job.status = 'failed';
    }
    job.error = job.status === 'paused_quota'
      ? 'Cuota de Gemini agotada. Configura facturación, usa otra clave/proveedor o espera al restablecimiento de la cuota para continuar.'
      : error.message;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { createJob, getJob, cleanJoinedTranscription };
