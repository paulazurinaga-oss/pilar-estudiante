const crypto = require('crypto');
const { generateImage, generateInfographic } = require('./aiService');

const jobs = new Map();
const ACTIVE_STATUSES = new Set(['queued', 'processing']);
const MAX_ACTIVE_PER_USER = 2;
const MAX_ACTIVE_JOBS = 20;
const JOB_RETENTION_MS = 60 * 60 * 1000;

function activeCount(userId) {
  return Array.from(jobs.values()).filter((job) =>
    ACTIVE_STATUSES.has(job.status) && (!userId || job.userId === userId),
  ).length;
}

function publicJob(job) {
  const { userId, ...visible } = job;
  return visible;
}

async function processJob(job) {
  job.status = 'processing';
  job.progress = 10;
  job.message = 'Gemini está procesando la solicitud.';
  try {
    job.result = job.type === 'infographic'
      ? await generateInfographic(job.prompt)
      : await generateImage(job.prompt);
    job.status = 'completed';
    job.progress = 100;
    job.message = 'Completado.';
  } catch (error) {
    job.status = 'failed';
    job.progress = 100;
    job.error = error.message || 'No se pudo completar la tarea de IA.';
    job.quotaExceeded = Boolean(error.status === 429 || /429|quota/i.test(error.message || ''));
    job.message = 'La tarea de IA falló.';
    console.error(`[PILAR][ai-job] ${job.id}: ${job.error}`);
  }
  job.completedAt = new Date().toISOString();
}

function createAiJob({ userId, type, prompt }) {
  if (!['infographic', 'image'].includes(type)) throw new Error('Tipo de tarea de IA no válido.');
  if (activeCount(userId) >= MAX_ACTIVE_PER_USER || activeCount() >= MAX_ACTIVE_JOBS) {
    throw new Error('La cola de IA está llena. Espera a que termine una tarea activa.');
  }
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (!ACTIVE_STATUSES.has(job.status) && now - Date.parse(job.completedAt || job.createdAt) > JOB_RETENTION_MS) {
      jobs.delete(id);
    }
  }
  const job = {
    id: crypto.randomUUID(),
    userId,
    type,
    status: 'queued',
    prompt,
    progress: 0,
    message: 'Tarea agregada a la cola.',
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  setImmediate(() => processJob(job));
  return publicJob(job);
}

function getAiJob(userId, id) {
  const job = jobs.get(id);
  return job?.userId === userId ? publicJob(job) : null;
}

module.exports = { createAiJob, getAiJob, activeCount };
