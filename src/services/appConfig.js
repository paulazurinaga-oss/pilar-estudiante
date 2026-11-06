const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.join(__dirname, '..', '..');
const executableDir = path.dirname(process.execPath);
const envCandidates = process.env.PILAR_ENV_PATH
  ? [process.env.PILAR_ENV_PATH]
  : process.resourcesPath
    ? [path.join(executableDir, '.env')]
    : [path.join(executableDir, '.env'), path.join(process.cwd(), '.env'), path.join(projectRoot, '.env')];
const envPath = envCandidates.find((candidate) => fs.existsSync(candidate)) || envCandidates[0];
const envResult = envPath && fs.existsSync(envPath)
  ? dotenv.config({ path: envPath })
  : { parsed: {} };
const envValues = envResult.parsed || {};
const dataRoot = process.env.PILAR_DATA_PATH
  || (process.env.PILAR_ENV_PATH ? path.join(executableDir, 'storage') : path.join(projectRoot, 'storage'));

const apiConfig = {
  appName: 'PILAR del estudiante',
  environment: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || envValues.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    transcriptionModel: process.env.GEMINI_TRANSCRIPTION_MODEL || 'gemini-flash-latest',
    imageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
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
