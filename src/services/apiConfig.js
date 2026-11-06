const apiConfig = {
  primaryProvider: 'gemini',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    transcriptionModel: process.env.GEMINI_TRANSCRIPTION_MODEL || 'gemini-flash-latest'
  }
};

module.exports = apiConfig;
