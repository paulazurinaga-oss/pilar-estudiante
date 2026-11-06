const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { transcribeAudio } = require('./aiService');

function resolveFfmpegPath() {
  const candidates = [];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'ffmpeg.exe'));
    candidates.push(path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'));
  }

  try {
    candidates.push(require('ffmpeg-static'));
  } catch {
    // El ejecutable externo puede ser la única opción disponible.
  }

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || 'ffmpeg';
}

const ffmpegPath = resolveFfmpegPath();

const jobs = new Map();
const DEFAULT_CHUNK_DURATION_SECONDS = Number(process.env.PILAR_AUDIO_CHUNK_SECONDS || 20 * 60);
const MAX_RECOMMENDED_AUDIO_SECONDS = 4 * 60 * 60;
const MAX_ACTIVE_JOBS_PER_USER = 2;
const MAX_ACTIVE_JOBS = 20;
const FFMPEG_TIMEOUT_MS = 15 * 60 * 1000;

function activeJobCount(userId) {
  return Array.from(jobs.values()).filter((job) =>
    ['queued', 'preparing', 'processing', 'merging'].includes(job.status)
    && (!userId || job.userId === userId)
  ).length;
}

function publicJob(job) {
  if (!job) return null;
  const { id, fileName, status, progress, completedChunks, totalChunks, currentChunk, text, error, pausedReason, message, savedFile } = job;
  return { id, fileName, status, progress, completedChunks, totalChunks, currentChunk, text, error, pausedReason, message, savedFile };
}

function cleanJoinedTranscription(parts) {
  const seenParagraphs = new Set();
  const cleaned = [];

  for (const part of parts || []) {
    const safePart = String(part || '').trim();
    if (!safePart) continue;

    const withoutHeaders = safePart
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

function createJob({ userId, filePath, fileName, mimeType, chunkSeconds = DEFAULT_CHUNK_DURATION_SECONDS }) {
  if (activeJobCount(userId) >= MAX_ACTIVE_JOBS_PER_USER || activeJobCount() >= MAX_ACTIVE_JOBS) {
    throw new Error('La cola de transcripción está llena. Espera a que terminen los trabajos activos.');
  }
  const now = Date.now();
  for (const [jobId, job] of jobs) {
    if (!['queued', 'preparing', 'processing', 'merging'].includes(job.status) && now - job.finishedAt > 60 * 60 * 1000) {
      jobs.delete(jobId);
    }
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const job = {
    id,
    userId,
    savedFile: null,
    finishedAt: 0,
    fileName,
    mimeType,
    status: 'queued',
    progress: 0,
    completedChunks: 0,
    totalChunks: 0,
    currentChunk: 0,
    text: '',
    error: null,
    pausedReason: null,
    cancelRequested: false,
    chunkSeconds,
    message: 'Preparando audio para transcripción.',
    tempDir: null,
    filePath,
  };
  Object.defineProperty(job, 'abortController', {
    value: new AbortController(),
    enumerable: false,
    writable: false,
  });
  jobs.set(id, job);
  processJob(job, { filePath, mimeType }).catch((error) => {
    if (job.status !== 'cancelled') {
      job.status = 'failed';
      job.error = error.message;
      job.message = 'La transcripción falló. Revisa el detalle técnico del servidor.';
    }
    job.finishedAt = Date.now();
  });
  return job;
}

function getJob(id, userId) {
  const job = jobs.get(id);
  return job?.userId === userId ? job : null;
}

function cancelJob(id, userId) {
  const job = getJob(id, userId);
  if (!job) return false;
  job.cancelRequested = true;
  job.abortController.abort();
  job.status = 'cancelled';
  job.message = 'Cancelando transcripción y limpiando archivos temporales...';
  return true;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args, { windowsHide: true });
    let errorOutput = '';
    const timeout = setTimeout(() => {
      process.kill('SIGKILL');
      reject(new Error('La preparación del audio superó el tiempo máximo permitido.'));
    }, FFMPEG_TIMEOUT_MS);
    process.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
    process.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    process.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `ffmpeg terminó con código ${code}.`));
    });
  });
}

async function processJob(job, { filePath, mimeType }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilar-transcription-'));
  const chunkPattern = path.join(workDir, 'chunk-%05d.mp3');
  job.status = 'preparing';
  job.tempDir = workDir;
  job.message = 'Preparando audio y validando archivos.';

  try {
    if (job.cancelRequested) {
      throw new Error('Transcripción cancelada antes de comenzar.');
    }

    job.message = 'Dividiendo el audio en fragmentos para evitar límites de Gemini.';
    const segmentLength = Math.min(job.chunkSeconds || DEFAULT_CHUNK_DURATION_SECONDS, MAX_RECOMMENDED_AUDIO_SECONDS);
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-i', filePath,
      '-vn', '-acodec', 'libmp3lame', '-f', 'segment',
      '-segment_time', String(segmentLength), '-reset_timestamps', '1', chunkPattern,
    ]);

    if (job.cancelRequested) {
      throw new Error('Transcripción cancelada durante la segmentación.');
    }

    const chunks = fs.readdirSync(workDir)
      .filter((fileName) => fileName.endsWith('.mp3'))
      .sort()
      .map((fileName) => path.join(workDir, fileName));

    if (!chunks.length) throw new Error('No se pudieron crear fragmentos de audio.');

    job.totalChunks = chunks.length;
    job.status = 'processing';

    const transcriptions = new Array(chunks.length);

    for (let index = 0; index < chunks.length; index += 1) {
      if (job.cancelRequested) throw new Error('Transcripción cancelada por el usuario.');

      const chunkPath = chunks[index];
      job.currentChunk = index + 1;
      job.message = `Transcribiendo parte ${job.currentChunk} de ${job.totalChunks}.`;
      job.progress = Math.round(((index + 1) / job.totalChunks) * 100);

      if (job.cancelRequested) throw new Error('Transcripción cancelada por el usuario.');
      const result = await transcribeAudio({
        fileName: `${job.fileName} - parte ${index + 1}`,
        buffer: fs.readFileSync(chunkPath),
        mimeType: 'audio/mpeg',
        signal: job.abortController.signal,
      });

      if (result.fallback && result.quotaExceeded) {
        job.status = 'paused_quota';
        job.pausedReason = 'Cuota de Gemini agotada. Espera al reinicio del plan o usa una clave con cuota disponible.';
        throw new Error(job.pausedReason);
      }

      if (result.fallback) {
        throw new Error(`Falló la parte ${index + 1}: ${result.userHelp || result.error || 'Error de transcripción'}`);
      }

      transcriptions[index] = String(result.text || '').trim();
      job.completedChunks = index + 1;
      job.progress = Math.round(((index + 1) / job.totalChunks) * 100);
    }

    job.status = 'merging';
    job.message = 'Uniendo texto final en orden y limpiando duplicados.';
    job.progress = 95;
    job.text = cleanJoinedTranscription(transcriptions);
    job.status = 'completed';
    job.progress = 100;
    job.message = 'Completado. La transcripción final está lista.';
  } catch (error) {
    if (job.cancelRequested) {
      job.status = 'cancelled';
      job.error = 'Transcripción cancelada por el usuario.';
      job.message = 'Transcripción cancelada. Se eliminaron los fragmentos temporales.';
    } else if (job.status === 'paused_quota') {
      job.error = job.pausedReason || error.message;
      job.message = 'Límite de cuota de Gemini alcanzado. Revisa tu plan o espera a que se recupere la cuota.';
    } else {
      job.status = 'failed';
      job.error = error.message;
      job.message = 'No se pudo completar la transcripción. Revisa el detalle; si Gemini está temporalmente saturado, espera y reintenta.';
    }
    console.error(`[PILAR][transcribe] ${job.fileName} => ${job.error}`);
  } finally {
    if (job.tempDir && fs.existsSync(job.tempDir)) {
      fs.rmSync(job.tempDir, { recursive: true, force: true });
    }
    job.finishedAt = Date.now();
  }
}

module.exports = {
  createJob,
  getJob,
  cancelJob,
  publicJob,
  activeJobCount,
  cleanJoinedTranscription,
  DEFAULT_CHUNK_DURATION_SECONDS,
  MAX_RECOMMENDED_AUDIO_SECONDS,
};
