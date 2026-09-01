const { apiConfig } = require('./appConfig');

async function geminiRequest({ model, parts }) {
  if (!apiConfig.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada.');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiConfig.gemini.apiKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${errText}`);
  }

  return response.json();
}

function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
}

function buildAiFallback(prompt, context = '') {
  const combined = `${prompt || ''} ${context || ''}`.toLowerCase();

  if (combined.includes('resum') || combined.includes('summary')) {
    return `Resumen:
- Idea principal: el contenido gira en torno a ${prompt || 'el tema principal'}.
- Objetivo: entender conceptos, método y aplicación práctica.
- Recomendación: conviértelo en fichas, preguntas y un esquema breve.`;
  }

  if (combined.includes('explica') || combined.includes('concept')) {
    return `Explicación:
1. Define el concepto clave.
2. Relaciónalo con la intención del estudio.
3. Aplica un ejemplo simple y una conclusión breve.`;
  }

  if (combined.includes('mapa') || combined.includes('esquema')) {
    return `Mapa conceptual:
Tema central → ${prompt || 'Concepto principal'}
├─ idea clave
├─ ejemplo
├─ comparación
└─ idea final`;
  }

  if (combined.includes('pdf') || combined.includes('documento')) {
    return `Trabajo con documento:
- Se revisa el contenido principal.
- Se extraen ideas, fechas y palabras clave.
- Se crea un resumen y una ficha de estudio lista para usar.`;
  }

  if (combined.includes('audio') || combined.includes('transcri')) {
    return `Revisión de audio:
- Se extraen ideas principales.
- Se ordenan ejemplos, conceptos y dudas.
- Se prepara un resumen y un esquema de estudio.`;
  }

  return `Respuesta específica para: "${prompt || 'tu solicitud'}".

Se puede trabajar de forma ordenada con:
- resumen breve
- explicación clara
- esquema o mapa conceptual
- preguntas de repaso
- material listo para estudiar.`;
}

async function generateAssistantReply(prompt, context = '') {
  try {
    const data = await geminiRequest({
      model: apiConfig.gemini.model,
      parts: [{
        text: `Eres el asistente académico de PILAR del estudiante. Responde con precisión, claridad y estructura útil para estudiar.\n${context ? `${context}\n` : ''}${prompt}`,
      }],
    });

    const content = extractGeminiText(data);
    if (!content) throw new Error('Gemini no devolvió contenido.');
    return {
      content,
      fallback: false,
    };
  } catch (error) {
    return {
      content: `${buildAiFallback(prompt, context)}\n\nNota: el servicio de IA quedó temporalmente fuera de servicio.`,
      fallback: true,
      error: error.message,
    };
  }
}

async function transcribeAudio({ fileName, buffer, mimeType = 'audio/mpeg' }) {
  try {
    const fileBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'base64');
    const data = await geminiRequest({
      model: apiConfig.gemini.transcriptionModel,
      parts: [
        { text: 'Transcribe literalmente este audio en español. Conserva el orden, separa hablantes si es posible y no inventes contenido.' },
        { inline_data: { mime_type: mimeType, data: fileBuffer.toString('base64') } },
      ],
    });

    const text = extractGeminiText(data);
    if (!text) throw new Error('Gemini no devolvió una transcripción.');
    return {
      fallback: false,
      text,
    };
  } catch (error) {
    const quotaExceeded = error.message.includes(' 429 ') || error.message.includes('RESOURCE_EXHAUSTED');
    return {
      fallback: true,
      text: `No se pudo transcribir ${fileName} con Gemini.\nError real de servicio: ${error.message}`,
      error: error.message,
      quotaExceeded,
    };
  }
}

async function textToSpeech({ text, voice = 'alloy' }) {
  return {
    fallback: true,
    message: 'Gemini se usa para IA y transcripción. El texto a voz continúa usando el navegador.',
    voice,
    text,
  };
}

module.exports = {
  generateAssistantReply,
  transcribeAudio,
  textToSpeech,
  buildAiFallback,
};
