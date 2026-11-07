const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const {
  generateAssistantReply,
  generateAssistantReplyStream,
  generateImage,
  generateInfographic,
  transcribeAudio,
} = require('../src/services/aiService');

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function geminiSuccess(text) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function overloaded() {
  return new Response(JSON.stringify({ error: { message: 'service temporarily overloaded' } }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'retry-after': '0' },
  });
}

test('retries a temporary transcription outage and recovers', async () => {
  let attempts = 0;
  global.fetch = async () => (++attempts < 4 ? overloaded() : geminiSuccess('Transcripción válida'));
  const result = await transcribeAudio({ fileName: 'audio.wav', buffer: Buffer.from('audio de prueba'), mimeType: 'audio/wav' });
  assert.equal(attempts, 4);
  assert.equal(result.fallback, false);
  assert.equal(result.text, 'Transcripción válida');
});

test('reports persistent 503 without fabricating an assistant answer', async () => {
  let attempts = 0;
  global.fetch = async () => { attempts += 1; return overloaded(); };
  const result = await generateAssistantReply('Explícame el material');
  assert.equal(attempts, 4);
  assert.equal(result.fallback, true);
  assert.equal(result.content, 'El asistente está procesando los datos. Por favor, aguarda unos instantes y reintenta.');
  assert.equal(result.error, undefined);
  assert.doesNotMatch(result.content, /503|UNAVAILABLE|Error|Gemini request failed/i);
  assert.doesNotMatch(result.content, /Respuesta específica para/i);
});

test('uses exponential backoff for three retries after a 503', async () => {
  const originalSetTimeout = global.setTimeout;
  const delays = [];
  let attempts = 0;
  global.setTimeout = (callback, delay, ...args) => {
    delays.push(delay);
    queueMicrotask(() => callback(...args));
    return 0;
  };
  global.fetch = async () => {
    attempts += 1;
    return attempts < 4 ? new Response('UNAVAILABLE', { status: 503 }) : geminiSuccess('Recuperado');
  };

  try {
    const result = await generateAssistantReply('Reintenta con backoff');
    assert.equal(result.content, 'Recuperado');
    assert.equal(attempts, 4);
    assert.deepEqual(delays, [1000, 2000, 4000]);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test('retries temporary network errors instead of failing on the first disconnect', async () => {
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts < 2) throw new TypeError('fetch failed');
    return geminiSuccess('Respuesta tras reconectar');
  };
  const result = await generateAssistantReply('Explícame el tema');
  assert.equal(attempts, 2);
  assert.equal(result.content, 'Respuesta tras reconectar');
  assert.equal(result.fallback, false);
});

test('allows up to ten minutes for a Gemini request by default', async () => {
  const originalTimeout = AbortSignal.timeout;
  const timeoutValues = [];
  AbortSignal.timeout = (milliseconds) => {
    timeoutValues.push(milliseconds);
    return originalTimeout.call(AbortSignal, milliseconds);
  };
  global.fetch = async () => geminiSuccess('Respuesta dentro del límite');

  try {
    const result = await generateAssistantReply('Explica el tema');
    assert.equal(result.fallback, false);
    assert.deepEqual(timeoutValues, [10 * 60_000]);
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

test('streams Gemini text chunks without trimming their whitespace', async () => {
  const chunks = [
    { candidates: [{ content: { parts: [{ text: 'Hola' }] } }] },
    { candidates: [{ content: { parts: [{ text: ' mundo.' }] } }] },
  ];
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('');
  let endpoint;
  global.fetch = async (url) => {
    endpoint = String(url);
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  };
  const received = [];
  const result = await generateAssistantReplyStream('Saluda', '', [], async (text) => received.push(text));
  assert.match(endpoint, /:streamGenerateContent\?alt=sse&key=/);
  assert.deepEqual(received, ['Hola', ' mundo.']);
  assert.equal(result.content, 'Hola mundo.');
  assert.equal(result.fallback, false);
});

test('retries a transient Gemini error before opening the text stream', async () => {
  const chunk = { candidates: [{ content: { parts: [{ text: 'Recuperado.' }] } }] };
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) return overloaded();
    return new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const result = await generateAssistantReplyStream('Reintenta', '', [], async () => {});
  assert.equal(attempts, 2);
  assert.equal(result.content, 'Recuperado.');
  assert.equal(result.fallback, false);
});

test('retries an UNAVAILABLE error in a stream event before sending text', async () => {
  const chunk = { candidates: [{ content: { parts: [{ text: 'Recuperado.' }] } }] };
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response('data: {"error":{"code":503,"status":"UNAVAILABLE"}}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const received = [];
  const result = await generateAssistantReplyStream('Reintenta el evento', '', [], async (text) => received.push(text));
  assert.equal(attempts, 2);
  assert.deepEqual(received, ['Recuperado.']);
  assert.equal(result.content, 'Recuperado.');
  assert.equal(result.fallback, false);
});

test('returns generated image bytes from Gemini', async () => {
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await generateImage('Una célula vegetal para estudiar');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.data, 'aW1hZ2U=');
  assert.deepEqual(requestBody.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
});

test('generates a validated Mermaid infographic with the text model', async () => {
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return geminiSuccess('flowchart TD\n  A[Inicio] --> B[Concepto]\n  B --> C[Resultado]');
  };
  const result = await generateInfographic('Mapa mental sobre fotosíntesis');
  assert.equal(result.format, 'mermaid');
  assert.match(result.mermaid, /^flowchart TD/);
  assert.equal(requestBody.generationConfig, undefined);
  assert.match(requestBody.contents[0].parts[0].text, /único diagrama Mermaid/i);
});

test('retries infographic generation after a Gemini 503', async () => {
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return attempts === 1
      ? overloaded()
      : geminiSuccess('flowchart TD\n  A[Inicio] --> B[Concepto]');
  };
  const result = await generateInfographic('Mapa conceptual de biología');
  assert.equal(attempts, 2);
  assert.match(result.mermaid, /^flowchart TD/);
});

test('rejects non-Mermaid infographic responses', async () => {
  global.fetch = async () => geminiSuccess('No puedo generar ese contenido.');
  await assert.rejects(() => generateInfographic('Mapa inválido'), /diagrama Mermaid válido/i);
});
