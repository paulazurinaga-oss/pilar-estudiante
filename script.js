const appShell = document.getElementById('appShell');
const welcomeModal = document.getElementById('welcomeModal');
const registerForm = document.getElementById('registerForm');
const studentNameInput = document.getElementById('studentName');
const studentEmailInput = document.getElementById('studentEmail');
const accountPasswordInput = document.getElementById('accountPassword');
const registrationCodeInput = document.getElementById('registrationCode');
const authError = document.getElementById('authError');
const authSubmit = document.getElementById('authSubmit');
const authModeToggle = document.getElementById('authModeToggle');
const studentNameField = document.getElementById('studentNameField');
const registrationCodeField = document.getElementById('registrationCodeField');
const trialNotice = document.getElementById('trialNotice');
const legalConsentField = document.getElementById('legalConsentField');
const legalConsentInput = document.getElementById('legalConsent');
const welcomeMessage = document.getElementById('welcomeMessage');
const statusText = document.getElementById('statusText');
const statFiles = document.getElementById('statFiles');
const statFolders = document.getElementById('statFolders');
const statTranscripts = document.getElementById('statTranscripts');
const libraryGrid = document.getElementById('libraryGrid');
const documentGrid = document.getElementById('documentGrid');
const audioGrid = document.getElementById('audioGrid');
const folderGrid = document.getElementById('folderGrid');
const transcriptOutput = document.getElementById('transcriptOutput');
const audioName = document.getElementById('audioName');
const audioPlayer = document.getElementById('audioPlayer');
const audioPlayerTitle = document.getElementById('audioPlayerTitle');
const transcriptionProgressLabel = document.getElementById('transcriptionProgressLabel');
const transcriptionProgressBar = document.getElementById('transcriptionProgressBar');
const cancelTranscriptionBtn = document.getElementById('cancelTranscriptionBtn');
const sendHubMenu = document.getElementById('sendHubMenu');
const imagePromptModal = document.getElementById('imagePromptModal');
const modalImagePrompt = document.getElementById('modalImagePrompt');
const imagePromptError = document.getElementById('imagePromptError');
const floatingAudioPlayer = document.getElementById('floatingAudioPlayer');
const floatingAudioTitle = document.getElementById('floatingAudioTitle');
const floatingAudioProgress = document.getElementById('floatingAudioProgress');
const floatingAudioTime = document.getElementById('floatingAudioTime');
const floatingAudioDuration = document.getElementById('floatingAudioDuration');
const floatingAudioSpeed = document.getElementById('floatingAudioSpeed');
const toggleSpeakerLabelsBtn = document.getElementById('toggleSpeakerLabelsBtn');
let activeTranscriptionJobId = null;
let transcriptionInProgress = false;
let sendMenuTarget = null;
let speakerLabelsVisible = true;
let speechUtterance = null;
let speechPlaybackStartedAt = 0;
let speechPlaybackDuration = 0;

function formatConceptMap(content) {
  const lines = String(content || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length || !lines.some((line) => /tema central|mapa conceptual/i.test(line))) {
    return null;
  }

  const blocks = [];
  for (const line of lines) {
    const rootMatch = line.match(/^tema central\s*[→:-]*\s*(.+)$/i);
    if (rootMatch) {
      blocks.push(`<div class="concept-root">${escapeHtml(rootMatch[1])}</div>`);
      continue;
    }
    const nodeMatch = line.match(/^[├└│─\-\s]*\s*([\w\s\u00C0-\u024F\-.,;:()\/?]+)$/u);
    if (nodeMatch) {
      blocks.push(`<div class="concept-node">${escapeHtml(nodeMatch[1].trim())}</div>`);
    } else {
      blocks.push(`<div class="concept-node">${escapeHtml(line)}</div>`);
    }
  }
  return blocks.length ? `<div class="concept-map-block">${blocks.join('')}</div>` : null;
}

function renderAiOutput(target, content) {
  const formattedMap = formatConceptMap(content);
  if (formattedMap) {
    target.innerHTML = formattedMap;
    return;
  }
  target.textContent = content;
}

function hideSendMenu() {
  sendMenuTarget = null;
  sendHubMenu.classList.add('hidden');
}

function showSendMenu(type, target = null) {
  sendMenuTarget = target || type;
  sendHubMenu.classList.remove('hidden');
}

function removeSpeakerLabels(text) {
  return String(text || '')
    .replace(/\*\*?\s*Hablante\s*:\s*\*\*?/gi, '')
    .replace(/\bHablante\s*:\s*/gi, '')
    .replace(/\*\*?\s*Speaker\s*:\s*\*\*?/gi, '')
    .replace(/\bSpeaker\s*:\s*/gi, '')
    .replace(/\n{3,}/g, '\n\n');
}

function toggleSpeakerLabels() {
  const nextVisible = !speakerLabelsVisible;
  speakerLabelsVisible = nextVisible;
  if (transcriptOutput.value) {
    transcriptOutput.value = nextVisible ? transcriptOutput.dataset.rawText || transcriptOutput.value : removeSpeakerLabels(transcriptOutput.dataset.rawText || transcriptOutput.value);
  }
  toggleSpeakerLabelsBtn.textContent = nextVisible ? 'Ocultar etiquetas' : 'Mostrar etiquetas';
  setStatus(nextVisible ? 'Etiquetas de hablantes activadas.' : 'Etiquetas de hablantes ocultas.');
}

function openImagePromptModal(initialPrompt = '') {
  modalImagePrompt.value = initialPrompt;
  imagePromptError.textContent = '';
  imagePromptModal.classList.remove('hidden');
  modalImagePrompt.focus();
}

function closeImagePromptModal() {
  imagePromptModal.classList.add('hidden');
  imagePromptError.textContent = '';
}

function friendlyImageError(errorMessage) {
  const message = String(errorMessage || '');
  if (/quota|429|resource_exhausted|rate limit|billing|credit/i.test(message)) {
    return 'La cuota de Gemini se agotó o el plan actual no permite más imágenes. Prueba más tarde o usa tu clave personal con más cuota.';
  }
  return 'No se pudo generar la imagen en este momento. Revisa la conexión y vuelve a intentarlo en unos minutos.';
}

function getActiveTextTarget() {
  const current = transcriptOutput.value.trim()
    || aiPrompt.value.trim()
    || document.getElementById('aiOutput').textContent.trim()
    || infographicCode?.textContent.trim();
  return current || 'Contenido a procesar';
}

function getActiveContent() {
  const tab = state.activeTab;
  if (tab === 'transcriptor' && transcriptOutput.value.trim()) {
    return { title: audioName.textContent || 'Transcripción', text: transcriptOutput.value.trim(), target: transcriptOutput };
  }
  if (tab === 'asistente' && (aiPrompt.value.trim() || document.getElementById('aiOutput').textContent.trim())) {
    return { title: 'Asistente IA', text: aiPrompt.value.trim() || document.getElementById('aiOutput').textContent.trim(), target: aiPrompt };
  }
  if (tab === 'imagenes' && latestInfographic?.mermaid) {
    return { title: latestInfographic.title || 'Mapa visual', text: latestInfographic.mermaid, target: infographicCode };
  }
  return { title: 'Contenido PILAR', text: getActiveTextTarget(), target: aiPrompt };
}

async function runGlobalAction(action) {
  const active = getActiveContent();
  if (action === 'copiar') {
    if (!active.text || active.text === 'Contenido a procesar') {
      setStatus('No hay contenido activo para copiar.');
      return;
    }
    try {
      await navigator.clipboard.writeText(active.text);
      setStatus('Contenido activo copiado.');
    } catch {
      setStatus('El navegador no permitió acceder al portapapeles.');
    }
    return;
  }
  if (action === 'pegar') {
    try {
      const pasted = await navigator.clipboard.readText();
      active.target.value = pasted;
      setStatus('Contenido pegado en la pestaña activa.');
    } catch {
      setStatus('El navegador no permitió leer el portapapeles.');
    }
    return;
  }
  if (action === 'eliminar') {
    if (state.activeTab === 'transcriptor') transcriptOutput.value = '';
    else if (state.activeTab === 'asistente') {
      aiPrompt.value = '';
      document.getElementById('aiOutput').textContent = '';
    } else if (state.activeTab === 'imagenes') {
      latestInfographic = null;
      infographicCode.textContent = 'Aún no hay una estructura generada.';
      generatedImage.textContent = 'El diagrama visual aparecerá aquí.';
    } else {
      active.target.value = '';
    }
    setStatus('Contenido activo eliminado.');
    return;
  }
  if (action === 'guardar') {
    if (!active.text || active.text === 'Contenido a procesar') {
      setStatus('No hay contenido activo para guardar.');
      return;
    }
    try {
      const fileName = `${active.title.replace(/[^a-z0-9áéíóúñ_-]+/gi, '-').slice(0, 60) || 'PILAR'}-${Date.now()}.txt`;
      const result = await saveTextToBackend(fileName, active.text);
      addSavedText(result.savedFile, active.title, active.text);
      setStatus('Contenido activo guardado en la biblioteca.');
    } catch (error) {
      setStatus(`No se pudo guardar el contenido: ${error.message}`);
    }
    return;
  }
  if (action === 'compartir') {
    if (!active.text || active.text === 'Contenido a procesar') {
      setStatus('No hay contenido activo para compartir.');
      return;
    }
    const shareText = `${active.title}\n\n${active.text}`;
    try {
      if (navigator.share) await navigator.share({ title: active.title, text: shareText });
      else {
        await navigator.clipboard.writeText(shareText);
        setStatus('Título y contenido copiados para compartir.');
        return;
      }
      setStatus('Contenido compartido.');
    } catch (error) {
      if (error.name !== 'AbortError') setStatus(`No se pudo compartir: ${error.message}`);
    }
  }
}

async function handleSendAction(action) {
  const target = sendMenuTarget;
  hideSendMenu();
  const targetFile = target && typeof target === 'object' ? target.file : null;
  const targetText = targetFile
    ? `${targetFile.name}. ${targetFile.type?.startsWith('audio/') ? 'Resume y analiza su contenido después de transcribirlo.' : 'Explica sus ideas principales y crea material de estudio.'}`
    : getActiveTextTarget();
  if (action === 'ai-summary') {
    const output = document.getElementById('aiOutput');
    if (targetFile) {
      aiPrompt.value = targetText;
    }
    output.textContent = 'Preparando respuesta...';
    output.textContent = await requestAiResponse(targetText, 'La operación proviene desde el menú de envío central.', []);
    activateTab('asistente');
    return;
  }

  if (action === 'save-folder') {
    if (!state.folders.length) {
      setStatus('Primero crea una carpeta en el Centro de estudio.');
      activateTab('centro');
      return;
    }

    const fileForFolder = target && typeof target === 'object' && target.file ? target : null;
    if (fileForFolder) {
      const folderName = window.prompt('¿En qué carpeta quieres guardar este archivo?', state.folders[0].name);
      if (!folderName) return;
      const folder = state.folders.find((item) => item.name.toLowerCase() === folderName.toLowerCase());
      if (!folder) {
        setStatus('La carpeta elegida no existe.');
        return;
      }
      folder.items = Array.from(new Set([...(folder.items || []), fileForFolder.file.name]));
      await persistFolders();
      renderFolders();
      setStatus(`Archivo movido a la carpeta ${folder.name}.`);
      return;
    }

    const folderName = window.prompt('¿En qué carpeta quieres guardar esta respuesta?', state.folders[0].name);
    if (!folderName) return;
    const folder = state.folders.find((item) => item.name.toLowerCase() === folderName.toLowerCase());
    if (!folder) {
      setStatus('La carpeta elegida no existe.');
      return;
    }
    const response = document.getElementById('aiOutput').textContent.trim() || targetText;
    const fileName = `PILAR-${Date.now()}.txt`;
    try {
      const saved = await saveTextToBackend(fileName, response);
      folder.items = Array.from(new Set([...(folder.items || []), saved.savedFile.originalName || fileName]));
      await persistFolders();
      renderFolders();
      setStatus(`Contenido guardado en la carpeta ${folder.name}.`);
    } catch (error) {
      setStatus(`No se pudo guardar el contenido: ${error.message}`);
    }
    return;
  }

  if (action === 'export-share') {
    const exportText = transcriptOutput.value.trim() || document.getElementById('aiOutput').textContent.trim() || targetText;
    if (!exportText) {
      setStatus('No hay contenido para exportar.');
      return;
    }
    const shareWith = window.confirm('¿Quieres exportar el contenido como archivo TXT local?');
    if (shareWith) {
      const fileName = `PILAR-export-${Date.now()}.txt`;
      const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      setStatus('Archivo TXT descargado localmente.');
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: 'PILAR del estudiante', text: exportText });
      setStatus('Contenido compartido.');
      return;
    }
    await navigator.clipboard.writeText(exportText);
    setStatus('Contenido copiado para compartir por WhatsApp o correo.');
  }
}

function bindSendHub() {
  document.querySelectorAll('[data-send-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.sendAction;
      if (action === 'close') {
        hideSendMenu();
        return;
      }
      await handleSendAction(action);
    });
  });

  document.querySelectorAll('[data-action="enviar"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      const card = event.currentTarget.closest('.card');
      showSendMenu('file', card ? { file: { name: card.querySelector('h4')?.textContent || 'archivo' } } : null);
    });
  });
}

function formatPlaybackTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function showFloatingAudioPlayer({ title, kind = 'audio' }) {
  floatingAudioTitle.textContent = title || 'Reproducción';
  floatingAudioPlayer.classList.remove('hidden');
  floatingAudioPlayer.dataset.kind = kind;
}

function hideFloatingAudioPlayer() {
  floatingAudioPlayer.classList.add('hidden');
}

function updateFloatingAudioFromElement() {
  if (!audioPlayer.src) return;
  const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
  const current = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
  floatingAudioTitle.textContent = audioPlayerTitle.textContent || 'Reproducción';
  floatingAudioProgress.value = duration ? Math.max(0, Math.min(100, (current / duration) * 100)) : 0;
  floatingAudioTime.textContent = formatPlaybackTime(current);
  floatingAudioDuration.textContent = formatPlaybackTime(duration);
  if (!floatingAudioPlayer.classList.contains('hidden')) {
    showFloatingAudioPlayer({ title: floatingAudioTitle.textContent, kind: 'audio' });
  }
}

function bindFloatingAudioControls() {
  document.querySelectorAll('[data-floating-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.floatingAction;
      if (action === 'toggle-play') {
        if (audioPlayer && audioPlayer.src) {
          if (audioPlayer.paused) {
            audioPlayer.play();
            showFloatingAudioPlayer({ title: audioPlayerTitle.textContent || 'Reproducción', kind: 'audio' });
          } else {
            audioPlayer.pause();
          }
        } else if ('speechSynthesis' in window && speechUtterance) {
          if (speechSynthesis.paused) {
            speechSynthesis.resume();
          } else if (speechSynthesis.speaking) {
            speechSynthesis.pause();
          } else {
            speechSynthesis.speak(speechUtterance);
          }
        }
        return;
      }

      if (action === 'rewind') {
        if (audioPlayer && audioPlayer.src) audioPlayer.currentTime = Math.max(audioPlayer.currentTime - 10, 0);
        else if (speechUtterance) speechUtterance.rate = Number(floatingAudioSpeed.value || 1);
        return;
      }

      if (action === 'forward') {
        if (audioPlayer && audioPlayer.src) audioPlayer.currentTime = Math.min(audioPlayer.currentTime + 10, audioPlayer.duration || audioPlayer.currentTime);
        else if (speechUtterance) speechUtterance.rate = Number(floatingAudioSpeed.value || 1);
      }
    });
  });

  document.getElementById('floatingAudioCloseBtn').addEventListener('click', () => {
    hideFloatingAudioPlayer();
    if (audioPlayer && audioPlayer.src) {
      audioPlayer.pause();
    }
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }
  });

  floatingAudioSpeed.addEventListener('change', () => {
    const speed = Number(floatingAudioSpeed.value || 1);
    if (audioPlayer && audioPlayer.src) {
      audioPlayer.playbackRate = speed;
      return;
    }
    if (speechUtterance) {
      speechUtterance.rate = speed;
      if ('speechSynthesis' in window && speechSynthesis.speaking && !speechSynthesis.paused) {
        speechSynthesis.cancel();
        speechSynthesis.speak(speechUtterance);
      }
    }
  });

  audioPlayer.addEventListener('loadedmetadata', updateFloatingAudioFromElement);
  audioPlayer.addEventListener('timeupdate', updateFloatingAudioFromElement);
  audioPlayer.addEventListener('play', () => showFloatingAudioPlayer({ title: audioPlayerTitle.textContent || 'Reproducción', kind: 'audio' }));
  audioPlayer.addEventListener('pause', () => {
    if (audioPlayer.currentTime && audioPlayer.currentTime >= audioPlayer.duration) {
      hideFloatingAudioPlayer();
    }
  });
}

const API_BASE = '/api';

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ error: 'Request failed' }));
    if (response.status === 401) {
      document.getElementById('welcomeModal').classList.remove('hidden');
      document.getElementById('appShell').classList.add('hidden');
      setAuthMode('login');
    }
    throw new Error(errorPayload.error || 'Request failed');
  }

  return response.json().catch(() => ({}));
}

async function uploadFormData(path, formData) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(errorPayload.error || 'Upload failed');
  }

  return response.json().catch(() => ({}));
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file, file.name);
  return uploadFormData('/upload', formData);
}

async function saveTextToBackend(fileName, content) {
  return apiRequest('/storage/text', {
    method: 'POST',
    body: JSON.stringify({ fileName, content }),
  });
}

const state = {
  activeTab: 'inicio',
  files: [],
  folders: [],
  transcriptions: 0,
  lastPdfFolder: 'X'
};
let authMode = 'register';
let currentUser = null;

const initialTab = new URLSearchParams(window.location.search).get('tab');

function setStatus(message) {
  statusText.textContent = message;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function buildAiResponse(prompt, context = '') {
  const text = `${prompt} ${context}`.toLowerCase();

  if (text.includes('resum') || text.includes('summary')) {
    return `Resumen solicitado:\n- Idea principal: el contenido gira en torno a ${prompt || 'el tema principal'} y sus objetivos de aprendizaje.\n- Detalles clave: define conceptos, procedimientos y ejemplos prácticos.\n- Resultado: se recomienda convertirlo en fichas de estudio con 3 ideas centrales, 2 ejemplos y 5 preguntas de repaso.`;
  }

  if (text.includes('explica') || text.includes('explic')) {
    return `Explicación clara:\n1. Primero, identifica el objetivo del tema: ${prompt || 'el contenido entregado'}.\n2. Luego, explica la base conceptual con un lenguaje sencillo.\n3. Finalmente, conecta la teoría con un ejemplo aplicado y una conclusión breve.`;
  }

  if (text.includes('mapa') || text.includes('conceptual')) {
    return `Mapa conceptual sugerido:\nTema central → ${prompt || 'Concepto principal'}\n├─ Conceptos clave\n├─ Causas o causas y consecuencias\n├─ Ejemplos\n├─ Diferencias / comparaciones\n└─ Preguntas para repasar`;
  }

  if (text.includes('ficha') || text.includes('fichas')) {
    return `Ficha de estudio:\nTitulo: ${prompt || 'Tema principal'}\nDefinición: concepto esencial del contenido.\nEjemplo: aplicación práctica relevante.\nPregunta clave: ¿qué relación tiene con el objetivo del estudio?\nResumen final: 3 frases cortas con la idea principal.`;
  }

  if (text.includes('pregunta') || text.includes('quiz') || text.includes('evalu')) {
    return `Preguntas de repaso:\n1. ¿Cuál es la idea principal de ${prompt || 'este tema'}?\n2. ¿Qué elementos son indispensables para entenderlo?\n3. ¿Cómo se aplica en un ejemplo real?\n4. ¿Qué concepto se relaciona con este tema?\n5. ¿Qué dudas quedaron pendientes?`;
  }

  if (text.includes('audio') || text.includes('transcri')) {
    return `Revisión de audio:\n- Se recomienda transcribir con pausas y marcas temporales.\n- Extraer ideas principales, ejemplos y vocabulario técnico.\n- Generar un resumen breve y un esquema para estudio.`;
  }

  if (text.includes('pdf') || text.includes('documento')) {
    return `Trabajo con documento:\n- El archivo se guardará en la carpeta X y quedará listo para revisar.\n- Se puede resumir, destacar ideas clave, convertir en ficha o checklist.\n- También se puede enviar al asistente IA o a la pestaña de documentos.`;
  }

  if (text.includes('imagen') || text.includes('visual')) {
    return `Propuesta visual:\n- Genera una imagen representativa del tema: ${prompt || 'tema solicitado'}.\n- Usa estilo claro, legible y académico.\n- Incluye 1 elemento principal, 2 detalles de apoyo y un fondo minimalista.`;
  }

  return `Respuesta específica para: "${prompt || 'tu solicitud'}"\n\nSe puede trabajar así:\n- definir objetivos\n- resumir lo esencial\n- crear fichas o esquema\n- preparar preguntas de repaso\n- convertir el resultado en material listo para estudiar.`;
}

async function requestAiResponse(prompt, context = '', attachments = [], onText) {
  let content = '';
  try {
    const response = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ prompt, context, attachments }),
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({ error: 'Request failed' }));
      if (response.status === 401) {
        document.getElementById('welcomeModal').classList.remove('hidden');
        document.getElementById('appShell').classList.add('hidden');
        setAuthMode('login');
      }
      throw new Error(errorPayload.error || 'Request failed');
    }
    if (!response.body) throw new Error('El navegador no admite respuestas de streaming.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let completed = false;

    function processEvent(eventText) {
      if (!eventText || eventText.startsWith(':')) return;
      const lines = eventText.split(/\r?\n/);
      const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
      const data = lines.filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return;
      const payload = JSON.parse(data);
      if (event === 'delta') {
        content += payload.text || '';
        onText?.(payload.text || '');
      } else if (event === 'done') {
        completed = true;
      } else if (event === 'error') {
        throw new Error(payload.error || 'No se pudo completar la respuesta de IA.');
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop() || '';
      for (const eventText of events) processEvent(eventText);
      if (done) break;
    }
    if (pending.trim()) processEvent(pending);
    if (!completed) throw new Error('La conexión de streaming terminó antes de completar la respuesta.');
    if (!content) throw new Error('El servicio no devolvió contenido.');
    return content;
  } catch (error) {
    setStatus(`No se obtuvo respuesta de IA: ${error.message}`);
    const message = content
      ? `\n\nLa respuesta se interrumpió: ${error.message}`
      : `No se pudo obtener la respuesta. ${error.message}`;
    onText?.(message);
    return `${content}${message}`;
  }
}

function addSavedText(savedFile, displayName, content) {
  state.files = state.files.filter((item) => item.file.storageName !== savedFile.fileName);
  state.files.unshift({
    file: { name: displayName, storageName: savedFile.fileName, type: 'text/plain', size: new Blob([content]).size },
    relativePath: savedFile.relativePath,
    preview: content.slice(0, 120),
    icon: '📝',
  });
  renderLibrary();
  renderDocuments();
  updateStats();
}
function updateTranscriptionProgress(job) {
  if (!job) return;
  const label = job.message || 'Preparando audio...';
  const progress = Number.isFinite(job.progress) ? Math.max(0, Math.min(100, job.progress)) : 0;
  transcriptionProgressLabel.textContent = label;
  transcriptionProgressBar.style.width = `${progress}%`;
  setStatus(label);
}

async function waitForTranscription(jobId) {
  const deadline = Date.now() + 45 * 60 * 1000;
  while (true) {
    if (Date.now() >= deadline) {
      throw new Error('La transcripción superó el tiempo máximo de 45 minutos. Puedes reintentarlo con un archivo más corto.');
    }
    const job = await apiRequest(`/transcribe/jobs/${encodeURIComponent(jobId)}`, {
      signal: AbortSignal.timeout(30 * 1000),
    });
    updateTranscriptionProgress(job);

    if (job.status === 'completed') {
      activeTranscriptionJobId = null;
      return job;
    }
    if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'paused_quota') {
      activeTranscriptionJobId = null;
      throw new Error(job.error || 'La transcripción quedó pausada o falló.');
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function transcribeAudioFile(file) {
  if (!file) {
    setStatus('Selecciona un archivo de audio para transcribir.');
    return '';
  }
  if (transcriptionInProgress) {
    setStatus('Ya hay una transcripción en curso. Espera a que termine o cancélala.');
    return '';
  }

  transcriptionInProgress = true;
  transcriptionProgressLabel.textContent = 'Preparando audio...';
  transcriptionProgressBar.style.width = '0%';
  activeTranscriptionJobId = null;

  try {
    const formData = new FormData();
    formData.append('audio', file, file.name);
    const queued = await uploadFormData('/transcribe', formData);
    activeTranscriptionJobId = queued.jobId || null;
    updateTranscriptionProgress({ message: queued.message || 'Preparando audio...', progress: 5 });

    const result = queued.jobId ? await waitForTranscription(queued.jobId) : queued;
    const text = result?.text || 'No se pudo obtener la transcripción.';
    transcriptOutput.value = text;
    state.transcriptions += 1;
    updateStats();
    setStatus('Audio completo guardado y transcripción final en orden.');
    transcriptionProgressLabel.textContent = 'Completado';
    transcriptionProgressBar.style.width = '100%';

    const savedAudio = result.savedFile || queued.savedFile;
    if (savedAudio) {
      state.files.push({
        file: { name: file.name, storageName: savedAudio.fileName, type: file.type, size: file.size },
        relativePath: savedAudio.relativePath,
        preview: '',
        icon: '🎵',
      });
      renderLibrary();
      updateStats();
    }
    return text;
  } catch (error) {
    const message = error.message || 'Error no identificado';
    setStatus(`Transcripción fallida: ${message}`);
    transcriptionProgressLabel.textContent = 'Error de transcripción';
    transcriptionProgressBar.style.width = '0%';
    transcriptOutput.value = `No se pudo completar la transcripción del archivo ${file.name}.\n\nDetalle técnico:\n${message}`;
    return '';
  } finally {
    transcriptionInProgress = false;
  }
}


function updateStats() {
  statFiles.textContent = String(state.files.length);
  statFolders.textContent = String(state.folders.length);
  statTranscripts.textContent = String(state.transcriptions);
}

function activateTab(tabName) {
  state.activeTab = tabName;

  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const isActive = panel.dataset.panel === tabName;
    panel.classList.toggle('active', isActive);
  });

  document.querySelectorAll('.quick-card').forEach((card) => {
    const targetTab = card.dataset.tab;
    card.style.borderColor = targetTab === tabName ? 'rgba(139, 92, 246, 0.7)' : 'rgba(255,255,255,0.1)';
  });
}

document.querySelectorAll('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
});

document.querySelectorAll('.quick-card').forEach((card) => {
  card.addEventListener('click', () => activateTab(card.dataset.tab));
});

function setAuthMode(mode) {
  authMode = mode;
  const isRegistration = mode === 'register';
  studentNameField.classList.toggle('hidden', !isRegistration);
  studentNameInput.required = isRegistration;
  registrationCodeField.classList.toggle('hidden', !isRegistration);
  trialNotice.classList.toggle('hidden', !isRegistration);
  legalConsentField.classList.toggle('hidden', !isRegistration);
  legalConsentInput.required = isRegistration;
  accountPasswordInput.autocomplete = isRegistration ? 'new-password' : 'current-password';
  authSubmit.textContent = isRegistration ? 'Crear cuenta de prueba' : 'Iniciar sesión';
  authModeToggle.textContent = isRegistration ? 'Ya tengo una cuenta' : 'Crear cuenta de prueba';
  authError.textContent = '';
}

authModeToggle.addEventListener('click', () => {
  setAuthMode(authMode === 'register' ? 'login' : 'register');
});

async function enterApp(user) {
  currentUser = user;
  welcomeMessage.textContent = `Hola, ${user.name}`;
  welcomeModal.classList.add('hidden');
  appShell.classList.remove('hidden');
  const expiresAt = Date.parse(user.trialExpiresAt);
  const trialExpired = user.trialExpired || (Number.isFinite(expiresAt) && expiresAt <= Date.now());
  if (trialExpired) {
    setStatus('Tu prueba terminó; las funciones de IA están pausadas hasta activar una licencia.');
  } else if (user.plan === 'paid') {
    setStatus(`Licencia activa para ${user.email}.`);
  } else {
    const trialDate = Number.isFinite(expiresAt)
      ? new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(expiresAt))
      : 'fecha no disponible';
    setStatus(`Prueba activa hasta el ${trialDate}.`);
  }
  await loadStoredFiles();
  loadFoldersForCurrentUser();
  loadAiKeySettings();
  loadPaymentSettings();
}

async function loadPaymentSettings() {
  const panel = document.getElementById('webPurchasePanel');
  const priceLabel = document.getElementById('webPurchasePrice');
  const status = document.getElementById('webPurchaseStatus');
  try {
    const paymentConfig = await apiRequest('/payments/config');
    panel.classList.toggle('hidden', paymentConfig.desktop === true);
    if (!paymentConfig.enabled) {
      priceLabel.textContent = 'La compra online todavía no está habilitada.';
      document.getElementById('buyWebLicenseBtn').disabled = true;
    } else {
      priceLabel.textContent = `Pago único: ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: paymentConfig.currency }).format(paymentConfig.amount)}.`;
      document.getElementById('buyWebLicenseBtn').disabled = false;
    }
    const orderId = new URLSearchParams(window.location.search).get('payment');
    if (orderId) await checkPaymentReturn(orderId, status);
  } catch (error) {
    panel.classList.add('hidden');
    setStatus(`No se pudo consultar el estado de compra: ${error.message}`);
  }
}

async function checkPaymentReturn(orderId, statusElement) {
  statusElement.textContent = 'Verificando el pago con el servidor…';
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = await apiRequest(`/payments/status?orderId=${encodeURIComponent(orderId)}`);
      if (result.status === 'approved') {
        const session = await apiRequest('/auth/me');
        currentUser = session.user;
        statusElement.textContent = 'Pago confirmado. La licencia ya está activa en esta cuenta.';
        setStatus('Licencia web activada tras confirmar el pago.');
        window.history.replaceState({}, '', window.location.pathname);
        return;
      }
      if (['creation_failed', 'review_required'].includes(result.status)) {
        statusElement.textContent = 'No se pudo confirmar esta compra. Contacta a soporte antes de volver a pagar.';
        return;
      }
      statusElement.textContent = 'Pago pendiente de confirmación de Mercado Pago. No vuelvas a pagar; esta pantalla se actualizará.';
    } catch (error) {
      statusElement.textContent = `No se pudo verificar todavía: ${error.message}`;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  statusElement.textContent = 'Mercado Pago aún no confirmó el pago. Inicia sesión más tarde para revisar el estado.';
}

async function loadAiKeySettings() {
  const panel = document.getElementById('personalGeminiKeyPanel');
  const status = document.getElementById('personalGeminiKeyStatus');
  try {
    const config = await apiRequest('/config/ai');
    panel.classList.toggle('hidden', !config.canSetPersonalKey);
    if (config.canSetPersonalKey) {
      status.textContent = config.geminiConfigured
        ? 'Hay una clave configurada en este perfil. Por seguridad no se muestra.'
        : 'PILAR de escritorio necesita tu propia clave de Gemini para usar IA y transcripción.';
    }
  } catch (error) {
    panel.classList.add('hidden');
    setStatus(`No se pudo revisar la configuración de IA: ${error.message}`);
  }
}

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authError.textContent = '';
  authSubmit.disabled = true;
  try {
    const path = authMode === 'register' ? '/auth/register' : '/auth/login';
    const payload = {
      email: studentEmailInput.value,
      password: accountPasswordInput.value,
    };
    if (authMode === 'register') {
      payload.name = studentNameInput.value;
      payload.registrationCode = registrationCodeInput.value;
      payload.legalConsent = legalConsentInput.checked;
    }
    const result = await apiRequest(path, { method: 'POST', body: JSON.stringify(payload) });
    accountPasswordInput.value = '';
    registrationCodeInput.value = '';
    await enterApp(result.user);
  } catch (error) {
    authError.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await apiRequest('/auth/logout', { method: 'POST', body: '{}' });
  } finally {
    currentUser = null;
    state.files = [];
    renderLibrary();
    renderDocuments();
    renderAudios();
    welcomeModal.classList.remove('hidden');
    appShell.classList.add('hidden');
    setAuthMode('login');
  }
});

document.getElementById('activateLicenseBtn').addEventListener('click', async () => {
  const input = document.getElementById('licenseCodeInput');
  const code = input.value.trim();
  if (!code) {
    setStatus('Escribe tu código de licencia.');
    return;
  }
  try {
    const result = await apiRequest('/auth/activate', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    input.value = '';
    currentUser = result.user;
    setStatus(result.message);
  } catch (error) {
    setStatus(`No se pudo activar la licencia: ${error.message}`);
  }
});

document.getElementById('savePersonalGeminiKey').addEventListener('click', async () => {
  const input = document.getElementById('personalGeminiKey');
  const status = document.getElementById('personalGeminiKeyStatus');
  const apiKey = input.value.trim();
  if (!apiKey) {
    status.textContent = 'Pega tu clave de Gemini para guardarla en este equipo.';
    return;
  }
  try {
    const result = await apiRequest('/config/ai-key', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    });
    input.value = '';
    status.textContent = result.message || 'Clave guardada. No se muestra nuevamente.';
    setStatus('La clave personal de Gemini quedó configurada en este equipo.');
  } catch (error) {
    status.textContent = error.message;
    setStatus(`No se pudo guardar la clave: ${error.message}`);
  }
});

document.getElementById('buyWebLicenseBtn').addEventListener('click', async () => {
  const button = document.getElementById('buyWebLicenseBtn');
  const status = document.getElementById('webPurchaseStatus');
  button.disabled = true;
  try {
    const checkout = await apiRequest('/payments/checkout', { method: 'POST', body: '{}' });
    window.location.assign(checkout.checkoutUrl);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});

document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
  const passwordInput = document.getElementById('deleteAccountPassword');
  if (!window.confirm('Esta acción elimina permanentemente tu cuenta, carpetas y archivos. ¿Quieres continuar?')) return;
  try {
    await apiRequest('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ password: passwordInput.value }),
    });
    passwordInput.value = '';
    currentUser = null;
    state.files = [];
    state.folders = [];
    renderLibrary();
    renderDocuments();
    renderAudios();
    renderFolders();
    welcomeModal.classList.remove('hidden');
    appShell.classList.add('hidden');
    setAuthMode('register');
    setStatus('La cuenta y sus datos se eliminaron.');
  } catch (error) {
    setStatus(`No se pudo eliminar la cuenta: ${error.message}`);
  }
});

async function restoreSession() {
  try {
    const response = await fetch(`${API_BASE}/auth/me`);
    if (!response.ok) return;
    const result = await response.json();
    await enterApp(result.user);
  } catch (error) {
    setStatus(`No se pudo restaurar la sesión: ${error.message}`);
  }
}

function addFileCard(file, targetGrid, options = {}) {
  const card = document.createElement('article');
  card.className = 'card';
  card.draggable = Boolean(file.relativePath);
  if (card.draggable) {
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-pilar-file', JSON.stringify({
        name: file.name,
        storageName: file.storageName || file.name,
      }));
    });
  }

  const typeLabel = file.type || 'archivo';
  const icon = options.icon || (typeLabel.includes('audio') ? '🎵' : typeLabel.includes('image') ? '🖼️' : typeLabel.includes('pdf') ? '📕' : typeLabel.includes('text') || typeLabel.includes('document') ? '📄' : '📁');

  const preview = options.preview || '';
  const isImage = typeLabel.includes('image') && (preview || file.relativePath);
  const isVideo = typeLabel.includes('video') && file.relativePath;
  const mediaPreview = isImage
    ? `<img src="${escapeHtml(preview || file.relativePath)}" alt="${escapeHtml(file.name)}" style="width:100%;height:120px;object-fit:cover;border-radius:12px;" />`
    : isVideo
      ? `<video src="${escapeHtml(file.relativePath)}" controls preload="metadata" style="width:100%;max-height:180px;border-radius:12px;"></video>`
      : '';

  card.innerHTML = `
    <div>
      <div class="file-icon">${icon}</div>
      <h4>${escapeHtml(file.name)}</h4>
      <p>${file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'Archivo'} · ${escapeHtml(typeLabel)}</p>
    </div>
    ${mediaPreview || preview ? `<div class="preview-box">${mediaPreview || `<div style="padding:12px;border-radius:12px;background:rgba(255,255,255,0.04);">${escapeHtml(preview)}</div>`}</div>` : ''}
    <div class="card-actions">
      <button>Vista previa</button>
      <button>Descargar</button>
      <button>Enviar</button>
      <button>Compartir</button>
      <button>Eliminar</button>
    </div>
  `;

  card.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.textContent.trim().toLowerCase();

      if (action === 'descargar' && file.relativePath) {
        window.open(file.relativePath, '_blank', 'noopener');
        return;
      }

      if (action === 'vista previa' && file.relativePath) {
        if (file.type.includes('audio')) {
          audioPlayer.src = file.relativePath;
          audioPlayerTitle.textContent = file.name;
          activateTab('audios');
        } else {
          window.open(file.relativePath, '_blank', 'noopener');
        }
        return;
      }

      if (action === 'enviar') {
        showSendMenu('file', { file, preview });
        setStatus(`Elige el módulo de destino para ${file.name}.`);
        return;
      }

      if (action === 'compartir') {
        const body = await getFileShareBody(file, preview);
        const shareText = `${file.name}\n\n${body}`;
        if (navigator.share) {
          await navigator.share({ title: file.name, text: shareText, ...(file.relativePath ? { url: new URL(file.relativePath, window.location.href).href } : {}) }).catch(() => {});
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(shareText);
          setStatus(`Documento completo copiado para compartir: ${file.name}`);
        } else {
          setStatus('No se pudo acceder al portapapeles en este navegador.');
        }
        return;
      }

      if (action === 'eliminar' && file.relativePath) {
        try {
          const storageName = file.storageName || file.name;
          await apiRequest(`/storage/files/uploads/${encodeURIComponent(storageName)}`, { method: 'DELETE' });
          state.files = state.files.filter((item) => item.file.name !== file.name);
          renderLibrary();
          renderDocuments();
          renderAudios();
          updateStats();
          setStatus(`Archivo eliminado: ${file.name}`);
        } catch (error) {
          setStatus(`No se pudo eliminar ${file.name}: ${error.message}`);
        }
        return;
      }

      setStatus(`${action} ${file.name}`);
    });
  });

  targetGrid.appendChild(card);
}

async function getFileShareBody(file, preview = '') {
  const textual = file.type?.startsWith('text/') || /json|csv|javascript|xml/.test(file.type || '') || /\.(txt|md|csv|json|js|xml)$/i.test(file.name || '');
  if (textual && file.relativePath) {
    try {
      const response = await fetch(file.relativePath, { credentials: 'include' });
      if (response.ok) return await response.text();
    } catch {
      // El nombre y la vista previa siguen permitiendo compartir sin bloquear la interfaz.
    }
  }
  return preview || `Archivo de PILAR del estudiante (${file.type || 'formato desconocido'}).`;
}

function renderLibrary() {
  libraryGrid.innerHTML = '';
  state.files.forEach((item) => {
    addFileCard({ ...item.file, relativePath: item.relativePath }, libraryGrid, {
      preview: item.preview,
      icon: item.icon
    });
  });
}

function renderDocuments() {
  documentGrid.innerHTML = '';
  const docs = state.files.filter((item) => !item.file.type.includes('audio') && !item.file.type.includes('image'));
  docs.forEach((item) => {
    addFileCard({ ...item.file, relativePath: item.relativePath }, documentGrid, { preview: item.preview, icon: item.icon });
  });
}

function renderAudios() {
  audioGrid.innerHTML = '';
  state.files
    .filter((item) => item.file.type.includes('audio'))
    .forEach((item) => addFileCard({ ...item.file, relativePath: item.relativePath }, audioGrid, { icon: '🎵' }));
}

function renderFolders() {
  folderGrid.innerHTML = '';

  if (!state.folders.length) {
    const empty = document.createElement('div');
    empty.className = 'folder-card';
    empty.innerHTML = '<h4>Sin carpetas aún</h4><p>Crea una carpeta para organizar archivos, apuntes y materiales.</p>';
    folderGrid.appendChild(empty);
    return;
  }

  state.folders.forEach((folder) => {
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.dataset.folderId = folder.id || folder.name;
    const folderItems = Array.isArray(folder.items) ? folder.items : [];
    card.innerHTML = `
      <div>
        <div class="file-icon">📂</div>
        <h4>${escapeHtml(folder.name)}</h4>
        <p>${folderItems.length} elementos · Arrastra archivos aquí</p>
        <ul class="folder-items">${folderItems.slice(0, 50).map((item) => `<li title="${escapeHtml(item)}">${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
      <div class="folder-actions">
        <button data-action="add">Agregar</button>
        <button data-action="edit">Editar</button>
        <button data-action="delete">Eliminar</button>
      </div>
    `;

    card.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'add') {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.onchange = async (event) => {
            const added = await handleFiles(event.target.files, 'folder');
            folder.items.push(...added.map((item) => item.file.name));
            await persistFolders();
            renderFolders();
            setStatus(`${added.length} archivo(s) añadidos a la carpeta ${folder.name}.`);
          };
          input.click();
        }

        if (action === 'edit') {
          const newName = prompt(`Editar nombre de la carpeta: ${folder.name}`, folder.name);
          if (newName && newName.trim()) {
            folder.name = newName.trim();
            persistFolders();
            renderFolders();
            setStatus(`Carpeta renombrada a ${newName.trim()}.`);
          }
        }

        if (action === 'delete') {
          const index = state.folders.findIndex((item) => item.name === folder.name);
          if (index >= 0) {
            state.folders.splice(index, 1);
            persistFolders();
            renderFolders();
            setStatus(`Carpeta eliminada: ${folder.name}.`);
          }
        }
      });
    });

    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragleave', () => card.classList.remove('is-dragging'));
    card.addEventListener('drop', async (event) => {
      event.preventDefault();
      card.classList.remove('is-dragging');
      const droppedFiles = Array.from(event.dataTransfer?.files || []);
      const draggedLibraryFile = event.dataTransfer?.getData('application/x-pilar-file');
      let addedNames = [];
      if (droppedFiles.length) {
        const added = await handleFiles(droppedFiles, 'folder');
        addedNames = added.map((item) => item.file.name);
      } else if (draggedLibraryFile) {
        try {
          addedNames = [JSON.parse(draggedLibraryFile).name];
        } catch {
          setStatus('No se pudo identificar el archivo arrastrado.');
          return;
        }
      }
      if (!addedNames.length) return;
      folder.items = Array.from(new Set([...(folder.items || []), ...addedNames]));
      await persistFolders();
      renderFolders();
      setStatus(`${addedNames.length} archivo(s) añadidos a la carpeta ${folder.name}.`);
    });

    folderGrid.appendChild(card);
  });
}

async function handleFiles(files, target = 'library') {
  const addedItems = [];
  for (const file of Array.from(files)) {
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
    let savedFile;

    try {
      const result = await uploadFile(file);
      savedFile = result.savedFile;
    } catch (error) {
      setStatus(`No se pudo guardar ${file.name}: ${error.message}`);
      continue;
    }

    const item = {
      file: { ...file, name: file.name, type: file.type, size: file.size, storageName: savedFile?.fileName },
      preview,
      relativePath: savedFile?.relativePath,
      icon: file.type.includes('audio') ? '🎵' : file.type.includes('image') ? '🖼️' : file.type.includes('pdf') ? '📕' : file.type.includes('text') ? '📄' : '📁'
    };

    state.files.push(item);
    addedItems.push(item);

    if (file.type.includes('pdf')) {
      state.files[state.files.length - 1].file.type = file.type || 'application/pdf';
    }
  }

  renderLibrary();
  renderDocuments();
  renderAudios();
  renderFolders();
  updateStats();

  if (target === 'document') {
    setStatus('Documentos preparados para trabajar en fichas y estudiar.');
  }
  return addedItems;
}

async function loadStoredFiles() {
  try {
    const result = await apiRequest('/storage/files?folder=uploads');
    state.files = result.files.map((stored) => ({
      file: { name: stored.originalName, storageName: stored.fileName, type: stored.mimeType, size: stored.size },
      relativePath: stored.relativePath,
      preview: '',
      icon: stored.mimeType.includes('video') ? '🎬' : stored.mimeType.includes('audio') ? '🎵' : stored.mimeType.includes('image') ? '🖼️' : stored.mimeType.includes('pdf') ? '📕' : stored.mimeType.startsWith('text/') ? '📄' : '📁',
    }));
    renderLibrary();
    renderDocuments();
    renderAudios();
    updateStats();
  } catch (error) {
    setStatus(`No se pudo cargar la biblioteca: ${error.message}`);
  }
}

async function loadFoldersForCurrentUser() {
  try {
    const result = await apiRequest('/folders');
    state.folders = result.folders || [];
    renderFolders();
    updateStats();
  } catch (error) {
    setStatus(`No se pudieron cargar las carpetas: ${error.message}`);
  }
}

async function persistFolders() {
  const foldersToSave = state.folders.map((folder) => ({ ...folder, items: [...(folder.items || [])] }));
  try {
    const result = await apiRequest('/folders', {
      method: 'PUT',
      body: JSON.stringify({ folders: foldersToSave }),
    });
    state.folders = result.folders || state.folders;
  } catch (error) {
    setStatus(`No se pudieron guardar las carpetas: ${error.message}`);
  }
}

const uploadLibraryInput = document.getElementById('uploadLibraryInput');
uploadLibraryInput.addEventListener('change', (event) => {
  handleFiles(event.target.files);
});

const documentUploadInput = document.getElementById('documentUploadInput');
documentUploadInput.addEventListener('change', (event) => {
  handleFiles(event.target.files, 'document');
});

const audioLibraryInput = document.getElementById('audioLibraryInput');
audioLibraryInput.addEventListener('change', (event) => {
  handleFiles(event.target.files, 'audio');
});

const libraryDropZone = document.getElementById('libraryDropZone');
['dragenter', 'dragover'].forEach((eventName) => {
  libraryDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    libraryDropZone.style.borderColor = 'rgba(94, 234, 212, 0.7)';
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  libraryDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    libraryDropZone.style.borderColor = 'rgba(139, 92, 246, 0.7)';
  });
});

libraryDropZone.addEventListener('drop', (event) => {
  const files = event.dataTransfer.files;
  handleFiles(files);
});

const createFolderBtn = document.getElementById('createFolderBtn');
const folderNameInput = document.getElementById('folderNameInput');
createFolderBtn.addEventListener('click', async () => {
  const value = folderNameInput.value.trim();
  if (!value) {
    setStatus('Escribe un nombre para la carpeta.');
    return;
  }

  state.folders.push({ name: value, items: [] });
  folderNameInput.value = '';
  await persistFolders();
  renderFolders();
  updateStats();
  setStatus(`Carpeta creada: ${value}.`);
});

document.getElementById('newProjectBtn').addEventListener('click', () => {
  activateTab('centro');
  folderNameInput.focus();
});

const audioUploadInput = document.getElementById('audioUploadInput');
audioUploadInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  audioName.textContent = file.name;
  audioPlayerTitle.textContent = file.name;
  audioPlayer.src = URL.createObjectURL(file);
  setStatus(`Audio cargado para transcripción: ${file.name}`);
});

const transcribeBtn = document.getElementById('transcribeBtn');
transcribeBtn.addEventListener('click', () => {
  const currentFile = audioUploadInput.files?.[0];
  if (!currentFile) {
    setStatus('Primero carga un audio para transcribir.');
    return;
  }

  setStatus('Límite recomendado: audio de 3 a 4 horas dividido en fragmentos de 20 a 30 minutos para mantener estabilidad.');
  transcribeAudioFile(currentFile);
});

cancelTranscriptionBtn.addEventListener('click', async () => {
  if (!activeTranscriptionJobId) {
    setStatus('No hay una transcripción activa para cancelar.');
    return;
  }

  try {
    const result = await apiRequest(`/transcribe/jobs/${encodeURIComponent(activeTranscriptionJobId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ cancel: true }),
    });
    setStatus(result.message || 'Cancelación solicitada.');
    transcriptionProgressLabel.textContent = 'Cancelando...';
  } catch (error) {
    setStatus(`No se pudo cancelar: ${error.message}`);
  }
});

const copyTranscriptBtn = document.getElementById('copyTranscriptBtn');
copyTranscriptBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(transcriptOutput.value);
    setStatus('Transcripción copiada al portapapeles.');
  } catch (error) {
    setStatus('No se pudo copiar automáticamente, pero la transcripción está lista.');
  }
});

const saveTranscriptBtn = document.getElementById('saveTranscriptBtn');
saveTranscriptBtn.addEventListener('click', async () => {
  const text = transcriptOutput.value;
  if (!text.trim()) {
    setStatus('No hay transcripción para guardar.');
    return;
  }

  try {
    const result = await saveTextToBackend('Transcripcion.txt', text);
    addSavedText(result.savedFile, 'Transcripcion.txt', text);
    setStatus(result.message || 'Transcripción guardada en la biblioteca.');
  } catch (error) {
    setStatus(`No se pudo guardar en el servidor: ${error.message}`);
    return;
  }
});

const deleteTranscriptBtn = document.getElementById('deleteTranscriptBtn');
deleteTranscriptBtn.addEventListener('click', () => {
  transcriptOutput.value = 'La transcripción aparecerá aquí...';
  setStatus('Transcripción eliminada.');
});

const sendToAiBtn = document.getElementById('sendToAiBtn');
sendToAiBtn.addEventListener('click', async () => {
  const prompt = transcriptOutput.value.trim() || 'Resúmeme este material.';
  const output = document.getElementById('aiOutput');
  output.textContent = await requestAiResponse(prompt, 'Se solicita trabajar desde un audio o transcripción de estudio.');
  activateTab('asistente');
});

const generateMapBtn = document.getElementById('generateMapBtn');
generateMapBtn.addEventListener('click', async () => {
  const output = document.getElementById('aiOutput');
  const prompt = transcriptOutput.value.trim() || 'Tema principal del contenido';
  output.textContent = await requestAiResponse(`mapa conceptual para ${prompt}`);
  activateTab('asistente');
});

const generateImageBtn = document.getElementById('generateImageBtn');
const generateImageBtn2 = document.getElementById('generateImageBtn2');
const generatedImage = document.getElementById('generatedImage');
const imagePromptInput = document.getElementById('imagePrompt');
const infographicCode = document.getElementById('infographicCode');
const infographicCopyBtn = document.getElementById('infographicCopyBtn');
const infographicExportBtn = document.getElementById('infographicExportBtn');
const infographicSendAiBtn = document.getElementById('infographicSendAiBtn');
const infographicSendStudyBtn = document.getElementById('infographicSendStudyBtn');
let latestInfographic = null;

async function renderInfographic(mermaidCode) {
  generatedImage.replaceChildren();
  if (!window.mermaid) {
    generatedImage.textContent = mermaidCode;
    return;
  }
  window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
  try {
    const renderId = `pilar-infographic-${Date.now()}`;
    const result = await window.mermaid.render(renderId, mermaidCode);
    generatedImage.innerHTML = result.svg;
    result.bindFunctions?.(generatedImage);
  } catch (error) {
    generatedImage.textContent = mermaidCode;
    setStatus(`No se pudo dibujar el gráfico; se muestra la estructura. ${error.message}`);
  }
}

async function generateInfographicFromPrompt(prompt) {
  if (!prompt.trim()) {
    setStatus('Describe el mapa mental o la infografía que quieres generar.');
    return;
  }
  generatedImage.textContent = 'Generando estructura visual...';
  infographicCode.textContent = 'Generando...';
  try {
    const result = await apiRequest('/generate-infographic', {
      method: 'POST',
      body: JSON.stringify({ prompt: prompt.trim() }),
    });
    latestInfographic = { prompt: prompt.trim(), mermaid: result.mermaid, title: result.title || 'Infografía PILAR' };
    infographicCode.textContent = result.mermaid;
    await renderInfographic(result.mermaid);
    setStatus('Mapa visual generado.');
  } catch (error) {
    generatedImage.textContent = `No se pudo generar el mapa visual: ${error.message}`;
    infographicCode.textContent = 'No se generó ninguna estructura.';
    setStatus(`Generación visual fallida: ${error.message}`);
  }
}

generateImageBtn.addEventListener('click', () => {
  activateTab('imagenes');
  generateInfographicFromPrompt(transcriptOutput.value || 'Mapa mental del contenido principal');
});
generateImageBtn2.addEventListener('click', () => generateInfographicFromPrompt(imagePromptInput.value));

infographicCopyBtn.addEventListener('click', async () => {
  if (!latestInfographic) {
    setStatus('Genera un mapa visual antes de copiarlo.');
    return;
  }
  await navigator.clipboard.writeText(latestInfographic.mermaid);
  setStatus('Estructura Mermaid copiada.');
});

infographicExportBtn.addEventListener('click', () => {
  if (!latestInfographic) {
    setStatus('Genera un mapa visual antes de exportarlo.');
    return;
  }
  const blob = new Blob([latestInfographic.mermaid], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `PILAR-mapa-${Date.now()}.mmd`;
  link.click();
  URL.revokeObjectURL(link.href);
  setStatus('Estructura Mermaid exportada.');
});

infographicSendAiBtn.addEventListener('click', () => {
  if (!latestInfographic) {
    setStatus('Genera un mapa visual antes de enviarlo.');
    return;
  }
  aiPrompt.value = `Interpreta y explica esta estructura visual:\n\n${latestInfographic.mermaid}`;
  activateTab('asistente');
  setStatus('Mapa visual enviado al Asistente IA.');
});

infographicSendStudyBtn.addEventListener('click', async () => {
  if (!latestInfographic) {
    setStatus('Genera un mapa visual antes de guardarlo.');
    return;
  }
  try {
    const result = await saveTextToBackend(`Mapa-${Date.now()}.mmd`, latestInfographic.mermaid);
    addSavedText(result.savedFile, latestInfographic.title, latestInfographic.mermaid);
    activateTab('centro');
    setStatus('Mapa visual guardado en la biblioteca para el Centro de estudio.');
  } catch (error) {
    setStatus(`No se pudo guardar el mapa visual: ${error.message}`);
  }
});

const aiPrompt = document.getElementById('aiPrompt');
const aiFileInput = document.getElementById('aiFileInput');
const aiFileName = document.getElementById('aiFileName');
let aiAttachment = null;

aiFileInput.addEventListener('change', async (event) => {
  aiAttachment = event.target.files?.[0] || null;
  if (!aiAttachment) {
    aiFileName.textContent = 'Sin archivo adjunto';
    return;
  }

  aiFileName.textContent = `Adjunto: ${aiAttachment.name}`;
  if (aiAttachment.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(aiAttachment.name)) {
    const text = await aiAttachment.text();
    aiPrompt.value = `${aiPrompt.value.trim()}\n\nArchivo adjunto (${aiAttachment.name}):\n${text.slice(0, 50000)}`.trim();
    setStatus(`Contenido de ${aiAttachment.name} cargado en el asistente.`);
  } else if (aiAttachment.type === 'application/pdf' || ['image/png', 'image/jpeg', 'image/webp'].includes(aiAttachment.type) || /\.pdf$/i.test(aiAttachment.name)) {
    if (aiAttachment.size > 10 * 1024 * 1024) {
      aiFileName.textContent = `${aiAttachment.name} excede 10 MB`;
      aiAttachment = null;
      setStatus('El límite por archivo adjunto para análisis es 10 MB.');
      return;
    }
    setStatus(`${aiAttachment.name} listo para análisis multimodal.`);
  } else {
    aiFileName.textContent = `${aiAttachment.name}: formato no compatible`;
    aiAttachment = null;
    setStatus('El asistente admite texto, PDF, PNG, JPEG, WebP y audio.');
  }
});

const aiSendBtn = document.getElementById('aiSendBtn');
aiSendBtn.addEventListener('click', async () => {
  let prompt = aiPrompt.value.trim();
  const output = document.getElementById('aiOutput');
  if (!prompt) {
    output.textContent = 'Escribe tu pedido para que el asistente responda.';
    return;
  }

  let attachmentContext = '';
  const attachments = [];
  if (aiAttachment?.type?.startsWith('audio/')) {
    output.textContent = `Transcribiendo ${aiAttachment.name} antes de preparar la explicación...`;
    setStatus(`Procesando el audio adjunto: ${aiAttachment.name}`);
    const transcript = await transcribeAudioFile(aiAttachment);
    if (!transcript) {
      output.textContent = 'No se pudo transcribir el audio. Revisa el estado de Gemini y vuelve a intentarlo.';
      return;
    }
    attachmentContext = `Transcripción completa del audio ${aiAttachment.name}:\n${transcript}`;
    prompt = `${prompt}\n\nUsa la transcripción del audio adjunto para responder. No digas que no puedes escuchar el archivo.`;
  } else if (aiAttachment && (aiAttachment.type === 'application/pdf' || ['image/png', 'image/jpeg', 'image/webp'].includes(aiAttachment.type) || /\.pdf$/i.test(aiAttachment.name))) {
    const bytes = new Uint8Array(await aiAttachment.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const mimeType = aiAttachment.type || (aiAttachment.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    attachments.push({ mimeType, data: btoa(binary) });
    attachmentContext = `Analiza el archivo adjunto ${aiAttachment.name} y basa la respuesta en su contenido.`;
  } else if (aiAttachment) {
    attachmentContext = `Archivo de texto ${aiAttachment.name} incluido en la solicitud.`;
  }

  output.textContent = '';
  await requestAiResponse(
    prompt,
    `Se está trabajando con un pedido específico del usuario. ${attachmentContext}`,
    attachments,
    (text) => { output.textContent += text; },
  );
});

const aiCopyBtn = document.getElementById('aiCopyBtn');
aiCopyBtn.addEventListener('click', async () => {
  const output = document.getElementById('aiOutput');
  try {
    await navigator.clipboard.writeText(output.textContent);
    setStatus('Respuesta copiada.');
  } catch {
    setStatus('No se pudo copiar, pero el contenido está listo.');
  }
});

const aiSaveBtn = document.getElementById('aiSaveBtn');
aiSaveBtn.addEventListener('click', async () => {
  const response = document.getElementById('aiOutput').textContent;
  if (!response.trim()) {
    setStatus('No hay respuesta para guardar.');
    return;
  }
  try {
    const result = await saveTextToBackend('Asistente-IA.txt', response);
    addSavedText(result.savedFile, 'Asistente IA.txt', response);
    setStatus(result.message || 'Respuesta del asistente guardada en el servidor.');
  } catch (error) {
    setStatus(`No se pudo guardar la respuesta: ${error.message}`);
    return;
  }
});

const aiDeleteBtn = document.getElementById('aiDeleteBtn');
aiDeleteBtn.addEventListener('click', () => {
  document.getElementById('aiOutput').textContent = 'El asistente responderá con un resumen, explicación o esquema personalizado para tu contenido.';
  setStatus('Respuesta eliminada.');
});

const saveAction = document.getElementById('saveAction');
const copyAction = document.getElementById('copyAction');
const pasteAction = document.getElementById('pasteAction');
const deleteAction = document.getElementById('deleteAction');
const newProjectBtn = document.getElementById('newProjectBtn');

saveAction.addEventListener('click', () => runGlobalAction('guardar'));
copyAction.addEventListener('click', () => runGlobalAction('copiar'));
pasteAction.addEventListener('click', () => runGlobalAction('pegar'));
deleteAction.addEventListener('click', () => runGlobalAction('eliminar'));

newProjectBtn.addEventListener('click', () => {
  activateTab('centro');
  folderNameInput.focus();
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    const action = button.dataset.action;
    const actionLabel = {
      guardar: 'Guardado',
      copiar: 'Copiado',
      pegar: 'Pegado',
      eliminar: 'Eliminado',
      enviar: 'Enviado',
      compartir: 'Compartido',
      adelantar: 'Adelantado 10s',
      retrasar: 'Retrasado 10s',
      pausar: 'Pausado',
    }[action] || action;
    if (['guardar', 'copiar', 'pegar', 'eliminar', 'enviar', 'compartir'].includes(action)) {
      if (action === 'guardar') {
        await runGlobalAction('guardar');
        return;
      }
      if (action === 'copiar') {
        await runGlobalAction('copiar');
        return;
      }
      if (action === 'pegar') {
        await runGlobalAction('pegar');
        return;
      }
      if (action === 'eliminar') {
        await runGlobalAction('eliminar');
        return;
      }
      if (action === 'enviar') {
        showSendMenu('active');
        return;
      }
      if (action === 'compartir') {
        await runGlobalAction('compartir');
        return;
      }
    }
    setStatus(`${actionLabel} con éxito.`);

    if (action === 'adelantar') {
      audioPlayer.currentTime = Math.min(audioPlayer.currentTime + 10, audioPlayer.duration || audioPlayer.currentTime);
    }
    if (action === 'retrasar') {
      audioPlayer.currentTime = Math.max(audioPlayer.currentTime - 10, 0);
    }
    if (action === 'pausar') {
      audioPlayer.pause();
    }
  });
});

bindSendHub();

const globalSearch = document.querySelector('.topbar-search input');
globalSearch.addEventListener('input', () => {
  const query = globalSearch.value.trim().toLocaleLowerCase('es');
  document.querySelectorAll('.card, .folder-card').forEach((card) => {
    card.hidden = Boolean(query) && !card.textContent.toLocaleLowerCase('es').includes(query);
  });
});

const speakTextBtn = document.getElementById('speakTextBtn');
speakTextBtn.addEventListener('click', async () => {
  const text = transcriptOutput.value.trim();
  if (!text) {
    setStatus('No hay texto para leer en voz alta.');
    return;
  }

  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
    setStatus('Lectura en voz alta iniciada con la voz disponible en el dispositivo.');
  } else {
    setStatus('Tu navegador no admite texto a voz en este momento.');
  }
});

const themeSelect = document.getElementById('themeSelect');
const accentPicker = document.getElementById('accentPicker');
const customBackgroundInput = document.getElementById('customBackgroundInput');
const applyBackgroundBtn = document.getElementById('applyBackgroundBtn');
const fontSelect = document.getElementById('fontSelect');

themeSelect.addEventListener('change', () => {
  const themes = {
    default: 'radial-gradient(circle at top, #1c2a4f 0%, #0b1020 45%, #070b14 100%)',
    ocean: 'radial-gradient(circle at top, #0f4c81 0%, #0a1f38 45%, #040d17 100%)',
    sunset: 'radial-gradient(circle at top, #7a3b1c 0%, #26132d 45%, #100d1d 100%)',
    forest: 'radial-gradient(circle at top, #183b2d 0%, #0a1f1a 45%, #050d0d 100%)'
  };
  document.body.style.background = themes[themeSelect.value] || themes.default;
  setStatus(`Tema aplicado: ${themeSelect.value}.`);
});

accentPicker.addEventListener('input', () => {
  document.documentElement.style.setProperty('--accent', accentPicker.value);
  setStatus('Color principal actualizado.');
});

applyBackgroundBtn.addEventListener('click', () => {
  const value = customBackgroundInput.value.trim();
  if (!value) {
    setStatus('Ingresa una URL para aplicar un fondo personalizado.');
    return;
  }
  document.body.style.background = `linear-gradient(rgba(9,13,22,0.40), rgba(9,13,22,0.55)), url("${value}") center/cover no-repeat fixed`;
  setStatus('Fondo personalizado aplicado.');
});

fontSelect.addEventListener('change', () => {
  document.documentElement.style.setProperty('--font-main', fontSelect.value);
  setStatus(`Tipografía cambiada a ${fontSelect.value}.`);
});

renderLibrary();
renderDocuments();
renderFolders();
updateStats();
activateTab(['inicio', 'biblioteca', 'centro', 'transcriptor', 'audios', 'documentos', 'asistente', 'imagenes', 'configuracion'].includes(initialTab) ? initialTab : 'inicio');
restoreSession();

if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
  window.addEventListener('load', () => {
    if (document.visibilityState !== 'prerender') navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, { once: true });
}
