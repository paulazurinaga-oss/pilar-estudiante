const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.join(__dirname, '..', '..');
const executableDir = path.dirname(process.execPath);
const envCandidates = [
  process.env.AURAPILAR_ENV_PATH,
  path.join(executableDir, '.env'),
  path.join(process.cwd(), '.env'),
  path.join(projectRoot, '.env'),
].filter(Boolean);
const envPath = envCandidates.find((candidate) => fs.existsSync(candidate)) || envCandidates[0];
const envResult = envPath && fs.existsSync(envPath)
  ? dotenv.config({ path: envPath })
  : { parsed: {} };
const envValues = envResult.parsed || {};
const dataRoot = process.env.AURAPILAR_DATA_PATH
  || (process.env.AURAPILAR_ENV_PATH ? path.join(executableDir, 'storage') : path.join(projectRoot, 'storage'));

const apiConfig = {
  appName: 'PILAR del estudiante',
  environment: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || envValues.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    transcriptionModel: process.env.GEMINI_TRANSCRIPTION_MODEL || 'gemini-3.6-flash',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || envValues.ANTHROPIC_API_KEY || '',
  },
  storage: {
    baseDir: dataRoot,
    uploadsDir: path.join(dataRoot, 'uploads'),
    pdfDir: path.join(dataRoot, 'pdfs'),
  },
};

module.exports = { apiConfig };
