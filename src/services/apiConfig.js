const apiConfig = {
  primaryProvider: 'gemini',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    transcriptionModel: process.env.GEMINI_TRANSCRIPTION_MODEL || 'gemini-3.6-flash'
  }
};

module.exports = apiConfig;
