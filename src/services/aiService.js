const { apiConfig } = require('./appConfig');

const DEFAULT_GEMINI_REQUEST_TIMEOUT_MS = 10 * 60_000;
const MAX_GEMINI_REQUEST_TIMEOUT_MS = 15 * 60_000;
const MAX_GEMINI_RETRIES = 3;
const RETRYABLE_GEMINI_STATUSES = new Set([429, 500, 502, 503, 504]);
const configuredGeminiTimeout = process.env.PILAR_GEMINI_TIMEOUT_MS;
const GEMINI_REQUEST_TIMEOUT_MS = configuredGeminiTimeout === undefined || configuredGeminiTimeout.trim() === ''
  ? DEFAULT_GEMINI_REQUEST_TIMEOUT_MS
  : Number(configuredGeminiTimeout);

if (!Number.isSafeInteger(GEMINI_REQUEST_TIMEOUT_MS)
  || GEMINI_REQUEST_TIMEOUT_MS < 1_000
  || GEMINI_REQUEST_TIMEOUT_MS > MAX_GEMINI_REQUEST_TIMEOUT_MS) {
  throw new Error(`PILAR_GEMINI_TIMEOUT_MS debe ser un entero entre 1000 y ${MAX_GEMINI_REQUEST_TIMEOUT_MS}.`);
}

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAt = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(0, Math.min(retryAt - Date.now(), 60_000));
  }

  return Math.min(1000 * (2 ** attempt), 8000);
}

function isRetryableGeminiError(error) {
  const status = error?.status ?? error?.code;
  return RETRYABLE_GEMINI_STATUSES.has(Number(status))
    || String(status || '').toUpperCase() === 'UNAVAILABLE'
    || /\bUNAVAILABLE\b/i.test(error?.message || '');
}

function waitForRetry(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('Solicitud cancelada.'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal.reason || new Error('Solicitud cancelada.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function geminiRequest({ model, parts, signal, generationConfig }) {
  if (!apiConfig.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada.');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiConfig.gemini.apiKey)}`;
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS)])
    : AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS);
  let lastError;

  for (let attempt = 0; attempt <= MAX_GEMINI_RETRIES; attempt += 1) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: requestSignal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          ...(generationConfig ? { generationConfig } : {}),
        }),
      });
    } catch (error) {
      if (requestSignal.aborted || attempt === MAX_GEMINI_RETRIES) throw error;
      lastError = error;
      await waitForRetry(Math.min(1000 * (2 ** attempt), 8000), requestSignal);
      continue;
    }

    if (response.ok) {
      const data = await response.json();
      if (!data?.error) return data;
      lastError = new Error(data.error.message || 'Gemini devolvió un error.');
      lastError.status = data.error.status || data.error.code;
      lastError.code = data.error.code;
      if (!isRetryableGeminiError(lastError) || attempt === MAX_GEMINI_RETRIES) {
        throw lastError;
      }
      await waitForRetry(retryDelayMs(response, attempt), requestSignal);
      continue;
    }

    const errText = await response.text();
    lastError = new Error(`Gemini request failed: ${response.status} ${errText}`);
    lastError.status = response.status;
    if (!isRetryableGeminiError(lastError) || attempt === MAX_GEMINI_RETRIES) {
      throw lastError;
    }

    await waitForRetry(retryDelayMs(response, attempt), requestSignal);
  }

  throw lastError || new Error('Gemini no respondió.');
}

async function geminiStreamRequest({ model, parts, signal, onText }) {
  if (!apiConfig.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada.');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiConfig.gemini.apiKey)}`;
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS)])
    : AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS);
  let lastError;
  for (let attempt = 0; attempt <= MAX_GEMINI_RETRIES; attempt += 1) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: requestSignal,
        body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
      });
    } catch (error) {
      if (requestSignal.aborted || attempt === MAX_GEMINI_RETRIES) throw error;
      await waitForRetry(Math.min(1000 * (2 ** attempt), 8000), requestSignal);
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      lastError = new Error(`Gemini request failed: ${response.status} ${errorText}`);
      lastError.status = response.status;
      if (!isRetryableGeminiError(lastError) || attempt === MAX_GEMINI_RETRIES) throw lastError;
      await waitForRetry(retryDelayMs(response, attempt), requestSignal);
      continue;
    }

    if (!response.body) throw new Error('Gemini devolvió una respuesta de streaming vacía.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let content = '';

    async function processEvent(eventText) {
      const data = eventText.split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data || data === '[DONE]') return;

      const chunk = JSON.parse(data);
      if (chunk.error) {
        const error = new Error(chunk.error.message || 'Gemini devolvió un error de streaming.');
        error.status = chunk.error.status || chunk.error.code;
        error.code = chunk.error.code;
        throw error;
      }

      const text = chunk?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('');
      if (text) {
        content += text;
        await onText(text);
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const events = pending.split(/\r?\n\r?\n/);
        pending = events.pop() || '';
        for (const eventText of events) await processEvent(eventText);
        if (done) break;
      }
      if (pending.trim()) await processEvent(pending);
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      if (content || !isRetryableGeminiError(error) || attempt === MAX_GEMINI_RETRIES) throw error;
      lastError = error;
      await waitForRetry(retryDelayMs(null, attempt), requestSignal);
      continue;
    } finally {
      reader.releaseLock();
    }

    if (!content.trim()) throw new Error('Gemini no devolvió contenido.');
    return content;
  }

  throw lastError || new Error('Gemini no respondió.');
}

function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
}

function normalizeMermaid(content) {
  const fencedMatch = String(content || '').match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
  const mermaid = (fencedMatch ? fencedMatch[1] : String(content || '')).trim();
  if (!/^(flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/i.test(mermaid)) {
    throw new Error('Gemini no devolvió un diagrama Mermaid válido.');
  }
  if (mermaid.length > 12_000 || /<script|javascript:|onerror\s*=|onclick\s*=/i.test(mermaid)) {
    throw new Error('El diagrama visual devuelto no cumple los límites de seguridad.');
  }
  return mermaid;
}

function isQuotaError(error) {
  const message = error?.message || '';
  return error?.status === 429 || error?.code === 429 || error?.status === 'RESOURCE_EXHAUSTED'
    || /429|RESOURCE_EXHAUSTED|quota/i.test(message);
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

function buildAssistantParts(prompt, context, attachments) {
  const parts = [{
    text: `Eres el asistente académico de PILAR del estudiante. Responde con precisión, claridad y estructura útil para estudiar.\n${context ? `${context}\n` : ''}${prompt}`,
  }];
  let totalBytes = 0;
  for (const attachment of attachments) {
    const mimeType = String(attachment.mimeType || '');
    const data = String(attachment.data || '');
    const buffer = Buffer.from(data, 'base64');
    totalBytes += buffer.length;
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
      throw new Error(`Tipo de archivo no admitido para análisis: ${mimeType || 'desconocido'}.`);
    }
    if (!buffer.length || totalBytes > 12 * 1024 * 1024) {
      throw new Error('Los archivos adjuntos superan el límite conjunto de 12 MB o están vacíos.');
    }
    parts.push({ inline_data: { mime_type: mimeType, data: buffer.toString('base64') } });
  }
  return parts;
}

function assistantFailure(error) {
  const errorDetail = error?.message || 'Error desconocido';
  const quotaExceeded = isQuotaError(error);
  const userMessage = quotaExceeded
    ? 'Límite de cuota gratuita de Gemini alcanzado. Por favor, aguarda unos minutos.'
    : `No se obtuvo una respuesta de IA. Gemini puede estar temporalmente no disponible; revisa el modelo y vuelve a intentarlo. Detalle: ${errorDetail}`;
  return { content: userMessage, fallback: true, error: errorDetail, userMessage, quotaExceeded };
}

async function generateAssistantReply(prompt, context = '', attachments = []) {
  try {
    const parts = buildAssistantParts(prompt, context, attachments);
    const data = await geminiRequest({
      model: apiConfig.gemini.model,
      parts,
    });

    const content = extractGeminiText(data);
    if (!content) throw new Error('Gemini no devolvió contenido.');
    return {
      content,
      fallback: false,
    };
  } catch (error) {
    return assistantFailure(error);
  }
}

async function generateAssistantReplyStream(prompt, context = '', attachments = [], onText, signal) {
  try {
    const parts = buildAssistantParts(prompt, context, attachments);
    const content = await geminiStreamRequest({
      model: apiConfig.gemini.model,
      parts,
      signal,
      onText,
    });
    return { content, fallback: false, quotaExceeded: false };
  } catch (error) {
    if (signal?.aborted) throw error;
    const result = assistantFailure(error);
    await onText(result.content);
    return result;
  }
}

async function generateImage(prompt) {
  if (!apiConfig.gemini.apiKey) throw new Error('GEMINI_API_KEY no está configurada.');
  const data = await geminiRequest({
    model: apiConfig.gemini.imageModel,
    parts: [{ text: `Genera una imagen educativa basada en esta descripción. No agregues marcas de agua: ${String(prompt || '').slice(0, 4000)}` }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const image = parts.find((part) => part.inlineData?.data || part.inline_data?.data);
  if (!image) {
    const message = extractGeminiText(data);
    throw new Error(message || 'Gemini no devolvió una imagen.');
  }
  const mimeType = image.inlineData?.mimeType || image.inline_data?.mime_type || 'image/png';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
    throw new Error('Gemini devolvió un formato de imagen no compatible.');
  }
  return {
    mimeType,
    data: image.inlineData?.data || image.inline_data?.data,
  };
}

async function generateInfographic(prompt) {
  if (!apiConfig.gemini.apiKey) throw new Error('GEMINI_API_KEY no está configurada.');
  const data = await geminiRequest({
    model: apiConfig.gemini.model,
    parts: [{
      text: `Eres un diseñador de mapas mentales e infografías educativas. Convierte la solicitud en un único diagrama Mermaid claro y legible.
Reglas obligatorias:
- Devuelve únicamente código Mermaid, sin explicaciones ni bloques Markdown.
- Usa exactamente flowchart TD como primera línea.
- Usa entre 5 y 14 nodos, etiquetas breves en español y conexiones útiles.
- No uses HTML, SVG, scripts, URLs, estilos externos ni caracteres de control.

Solicitud del usuario:
${String(prompt || '').slice(0, 4000)}`,
    }],
  });
  const mermaid = normalizeMermaid(extractGeminiText(data));
  return {
    success: true,
    format: 'mermaid',
    mermaid,
    title: 'Mapa mental e infografía visual',
  };
}

async function transcribeAudio({ fileName, buffer, mimeType = 'audio/mpeg', signal }) {
  try {
    const fileBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'base64');
    const data = await geminiRequest({
      model: apiConfig.gemini.transcriptionModel,
      signal,
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
    const errorMessage = error?.message || 'Error desconocido';
    const quotaExceeded = /429|RESOURCE_EXHAUSTED|quota/i.test(errorMessage);
    const transientServiceError = /\b(500|502|503|504)\b|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|fetch failed|network|timed out|timeout/i.test(errorMessage);
    const authError = /401|403|INVALID_API_KEY|FORBIDDEN|UNAUTHENTICATED|unauthorized|not authorized/i.test(errorMessage);
    const notFound = /404|NOT_FOUND|model.*not found|not found/i.test(errorMessage);
    const userHelp = authError
      ? 'La clave de Gemini no es válida o no tiene permiso para este modelo.'
      : notFound
        ? 'El modelo de Gemini no existe o no está disponible para esta cuenta.'
        : transientServiceError
          ? 'Gemini está temporalmente saturado o no disponible. La solicitud se reintentó; espera un momento y vuelve a intentarlo.'
          : quotaExceeded
          ? 'La cuota de Gemini está agotada o está limitada por el plan actual.'
          : 'El servicio de Gemini respondió con un error de procesamiento.';
    return {
      fallback: true,
      text: `No se pudo transcribir ${fileName}.\n${userHelp}\nDetalle técnico: ${errorMessage}`,
      error: errorMessage,
      quotaExceeded,
      transientServiceError,
      userHelp,
    };
  }
}

async function textToSpeech({ text, voice = 'alloy' }) {
  return {
    fallback: true,
    message: 'La lectura en voz alta usa las voces disponibles en el navegador.',
    voice,
    text,
  };
}

module.exports = {
  generateAssistantReply,
  generateAssistantReplyStream,
  generateImage,
  generateInfographic,
  transcribeAudio,
  textToSpeech,
  buildAiFallback,
};
