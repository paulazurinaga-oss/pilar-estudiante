const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { generateAssistantReply, generateImage, generateInfographic, transcribeAudio } = require('../src/services/aiService');

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
  global.fetch = async () => (++attempts < 3 ? overloaded() : geminiSuccess('Transcripción válida'));
  const result = await transcribeAudio({ fileName: 'audio.wav', buffer: Buffer.from('audio de prueba'), mimeType: 'audio/wav' });
  assert.equal(attempts, 3);
  assert.equal(result.fallback, false);
  assert.equal(result.text, 'Transcripción válida');
});

test('reports persistent 503 without fabricating an assistant answer', async () => {
  let attempts = 0;
  global.fetch = async () => { attempts += 1; return overloaded(); };
  const result = await generateAssistantReply('Explícame el material');
  assert.equal(attempts, 3);
  assert.equal(result.fallback, true);
  assert.match(result.content, /temporalmente no disponible/i);
  assert.doesNotMatch(result.content, /Respuesta específica para/i);
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

test('rejects non-Mermaid infographic responses', async () => {
  global.fetch = async () => geminiSuccess('No puedo generar ese contenido.');
  await assert.rejects(() => generateInfographic('Mapa inválido'), /diagrama Mermaid válido/i);
});
