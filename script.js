const appShell = document.getElementById('appShell');
const welcomeModal = document.getElementById('welcomeModal');
const registerForm = document.getElementById('registerForm');
const studentNameInput = document.getElementById('studentName');
const studentEmailInput = document.getElementById('studentEmail');
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

const initialTab = new URLSearchParams(window.location.search).get('tab');

function setStatus(message) {
  statusText.textContent = message;
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

async function requestAiResponse(prompt, context = '') {
  try {
    const result = await apiRequest('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt, context }),
    });

    if (result?.content) {
      return result.content;
    }

    return buildAiResponse(prompt, context);
  } catch (error) {
    setStatus(`IA local activa: ${error.message}`);
    return buildAiResponse(prompt, context);
  }
}

async function waitForTranscription(jobId) {
  while (true) {
    const job = await apiRequest(`/transcribe/jobs/${encodeURIComponent(jobId)}`);
    if (job.status === 'completed') return job;
    if (job.status === 'failed' || job.status === 'paused_quota') {
      throw new Error(job.error || 'La transcripción quedó pausada.');
    }
    setStatus(`Transcribiendo en segundo plano: ${job.completedChunks}/${job.totalChunks || '?'} partes.`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function transcribeAudioFile(file) {
  if (!file) {
    setStatus('Selecciona un archivo de audio para transcribir.');
    return;
  }

  try {
    const formData = new FormData();
    formData.append('audio', file, file.name);
    const queued = await uploadFormData('/transcribe', formData);
    const result = queued.jobId ? await waitForTranscription(queued.jobId) : queued;

    const text = result?.text || 'No se pudo obtener la transcripción.';
    transcriptOutput.value = text;
    state.transcriptions += 1;
    updateStats();
    setStatus('Audio completo guardado y transcripción ordenada generada.');

    if (queued.savedFile) {
      state.files.push({
        file: { name: file.name, storageName: queued.savedFile.fileName, type: file.type, size: file.size },
        relativePath: queued.savedFile.relativePath,
        preview: '',
        icon: '🎵',
      });
      renderLibrary();
      updateStats();
    }
  } catch (error) {
    setStatus(`Transcripción en modo local: ${error.message}`);
    transcriptOutput.value = `Transcripción local para ${file.name}:\n\n${buildAiResponse(file.name, 'audio de estudio')}`;
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

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = studentNameInput.value.trim() || 'estudiante';
  const email = studentEmailInput.value.trim();
  welcomeMessage.textContent = `Hola, ${name}`;
  welcomeModal.classList.add('hidden');
  appShell.classList.remove('hidden');
  setStatus(email ? `Cuenta de prueba activada para ${email}.` : 'Cuenta de prueba activada.');
});

function addFileCard(file, targetGrid, options = {}) {
  const card = document.createElement('article');
  card.className = 'card';

  const typeLabel = file.type || 'archivo';
  const icon = options.icon || (typeLabel.includes('audio') ? '🎵' : typeLabel.includes('image') ? '🖼️' : typeLabel.includes('pdf') ? '📕' : typeLabel.includes('text') || typeLabel.includes('document') ? '📄' : '📁');

  const preview = options.preview || '';
  const isImage = typeLabel.includes('image') && (preview || file.relativePath);
  const isVideo = typeLabel.includes('video') && file.relativePath;
  const mediaPreview = isImage
    ? `<img src="${preview || file.relativePath}" alt="${file.name}" style="width:100%;height:120px;object-fit:cover;border-radius:12px;" />`
    : isVideo
      ? `<video src="${file.relativePath}" controls preload="metadata" style="width:100%;max-height:180px;border-radius:12px;"></video>`
      : '';

  card.innerHTML = `
    <div>
      <div class="file-icon">${icon}</div>
      <h4>${file.name}</h4>
      <p>${file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'Archivo'} · ${typeLabel}</p>
    </div>
    ${mediaPreview || preview ? `<div class="preview-box">${mediaPreview || `<div style="padding:12px;border-radius:12px;background:rgba(255,255,255,0.04);">${preview}</div>`}</div>` : ''}
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
        aiPrompt.value = `Trabaja sobre el archivo "${file.name}". ${file.type.includes('audio') ? 'Resume y analiza su contenido después de transcribirlo.' : 'Explica sus ideas principales y crea material de estudio.'}`;
        activateTab('asistente');
        setStatus(`Archivo preparado para enviarlo al asistente: ${file.name}`);
        return;
      }

      if (action === 'compartir') {
        if (navigator.share && file.relativePath) {
          await navigator.share({ title: file.name, text: `Archivo de PILAR: ${file.name}`, url: new URL(file.relativePath, window.location.href).href }).catch(() => {});
        } else {
          await navigator.clipboard?.writeText(file.name).catch(() => {});
          setStatus(`Nombre copiado para compartir: ${file.name}`);
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
    card.innerHTML = `
      <div>
        <div class="file-icon">📂</div>
        <h4>${folder.name}</h4>
        <p>${folder.items.length} elementos</p>
      </div>
      <div class="folder-actions">
        <button data-action="add" data-name="${folder.name}">Agregar</button>
        <button data-action="edit" data-name="${folder.name}">Editar</button>
        <button data-action="delete" data-name="${folder.name}">Eliminar</button>
      </div>
    `;

    card.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'add') {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.onchange = (event) => {
            const selectedFiles = Array.from(event.target.files);
            selectedFiles.forEach((file) => {
              folder.items.push(file.name);
            });
            renderFolders();
            setStatus(`Archivos añadidos a la carpeta ${folder.name}.`);
          };
          input.click();
        }

        if (action === 'edit') {
          const newName = prompt(`Editar nombre de la carpeta: ${folder.name}`, folder.name);
          if (newName && newName.trim()) {
            folder.name = newName.trim();
            renderFolders();
            setStatus(`Carpeta renombrada a ${newName.trim()}.`);
          }
        }

        if (action === 'delete') {
          const index = state.folders.findIndex((item) => item.name === folder.name);
          if (index >= 0) {
            state.folders.splice(index, 1);
            renderFolders();
            setStatus(`Carpeta eliminada: ${folder.name}.`);
          }
        }
      });
    });

    folderGrid.appendChild(card);
  });
}

async function handleFiles(files, target = 'library') {
  for (const file of Array.from(files)) {
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
    let savedFile;

    try {
      const result = await uploadFile(file);
      savedFile = result.savedFile;
    } catch (error) {
      setStatus(`Archivo mantenido solo en esta sesión: ${error.message}`);
    }

    const item = {
      file: { ...file, name: file.name, type: file.type, size: file.size, storageName: savedFile?.fileName },
      preview,
      relativePath: savedFile?.relativePath,
      icon: file.type.includes('audio') ? '🎵' : file.type.includes('image') ? '🖼️' : file.type.includes('pdf') ? '📕' : file.type.includes('text') ? '📄' : '📁'
    };

    state.files.push(item);

    if (file.type.includes('pdf')) {
      const folderName = 'X';
      state.folders.push({ name: folderName, items: [file.name] });
      setStatus(`PDF guardado en la carpeta ${folderName} y listo.`);
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

const imageUploadInput = document.getElementById('imageUploadInput');
imageUploadInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const generatedImage = document.getElementById('generatedImage');
  generatedImage.style.backgroundImage = `linear-gradient(135deg, rgba(139,92,246,0.3), rgba(94,234,212,0.25)), url('${URL.createObjectURL(file)}')`;
  generatedImage.textContent = '';
  setStatus(`Imagen cargada para mejorar: ${file.name}`);
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
createFolderBtn.addEventListener('click', () => {
  const value = folderNameInput.value.trim();
  if (!value) {
    setStatus('Escribe un nombre para la carpeta.');
    return;
  }

  state.folders.push({ name: value, items: [] });
  folderNameInput.value = '';
  renderFolders();
  updateStats();
  setStatus(`Carpeta creada: ${value}.`);
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

  transcribeAudioFile(currentFile);
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
    setStatus(result.message || 'Transcripción guardada en el servidor.');
  } catch (error) {
    setStatus(`No se pudo guardar en el servidor: ${error.message}`);
  }

  state.files.push({
    file: { name: 'Transcripción.txt', type: 'text/plain', size: text.length },
    preview: text.slice(0, 120),
    icon: '📝'
  });
  renderLibrary();
  updateStats();
  setStatus('Transcripción guardada en la biblioteca.');
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
  setStatus('Transcripción enviada al asistente IA con respuesta específica.');
  activateTab('asistente');
});

const generateMapBtn = document.getElementById('generateMapBtn');
generateMapBtn.addEventListener('click', async () => {
  const output = document.getElementById('aiOutput');
  const prompt = transcriptOutput.value.trim() || 'Tema principal del contenido';
  output.textContent = await requestAiResponse(`mapa conceptual para ${prompt}`);
  setStatus('Mapa conceptual generado.');
  activateTab('asistente');
});

const generateImageBtn = document.getElementById('generateImageBtn');
const generateImageBtn2 = document.getElementById('generateImageBtn2');
const generatedImage = document.getElementById('generatedImage');
const imagePromptInput = document.getElementById('imagePrompt');

async function generateImageFromPrompt(prompt) {
  if (!prompt.trim()) {
    setStatus('Describe la imagen que quieres generar.');
    return;
  }
  generatedImage.textContent = 'La IA está preparando una propuesta visual...';
  generatedImage.style.backgroundImage = '';
  const response = await requestAiResponse(
    `Crea una propuesta visual detallada para: ${prompt.trim()}. Incluye sujeto principal, composición, colores, estilo y texto visible si corresponde.`,
    'Responde específicamente al pedido de imagen y no uses una imagen genérica.'
  );
  generatedImage.textContent = response;
  setStatus('La IA respondió con una propuesta visual específica.');
}

generateImageBtn.addEventListener('click', () => generateImageFromPrompt(transcriptOutput.value || 'Resumen visual del contenido principal'));
generateImageBtn2.addEventListener('click', () => generateImageFromPrompt(imagePromptInput.value));

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
  } else {
    setStatus(`${aiAttachment.name} adjunto. La IA recibirá el tipo y nombre del archivo.`);
  }
});

const aiSendBtn = document.getElementById('aiSendBtn');
aiSendBtn.addEventListener('click', async () => {
  const prompt = aiPrompt.value.trim();
  const output = document.getElementById('aiOutput');
  if (!prompt) {
    output.textContent = 'Escribe tu pedido para que el asistente responda.';
    return;
  }
  const attachmentContext = aiAttachment
    ? `Archivo adjunto: ${aiAttachment.name} (${aiAttachment.type || 'tipo desconocido'}, ${aiAttachment.size} bytes).`
    : '';
  output.textContent = await requestAiResponse(prompt, `Se está trabajando con un pedido específico del usuario. ${attachmentContext}`);
  setStatus('Consulta enviada al asistente IA con respuesta adaptada al pedido.');
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
  try {
    const result = await saveTextToBackend('Asistente-IA.txt', response);
    setStatus(result.message || 'Respuesta del asistente guardada en el servidor.');
  } catch (error) {
    setStatus(`No se pudo guardar la respuesta: ${error.message}`);
  }

  state.files.push({
    file: { name: 'Asistente IA.txt', type: 'text/plain', size: response.length },
    preview: response.slice(0, 120),
    icon: '🤖'
  });
  renderLibrary();
  updateStats();
  setStatus('Respuesta del asistente guardada.');
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

saveAction.addEventListener('click', async () => {
  const content = transcriptOutput.value.trim() || document.getElementById('aiOutput').textContent.trim();
  if (!content) {
    setStatus('No hay contenido para guardar.');
    return;
  }

  try {
    const result = await saveTextToBackend(`PILAR-${Date.now()}.txt`, content);
    setStatus(result.message || 'Contenido guardado en el servidor.');
  } catch (error) {
    setStatus(`No se pudo guardar el contenido: ${error.message}`);
  }
});
copyAction.addEventListener('click', async () => {
  const text = transcriptOutput.value || aiPrompt.value || 'Contenido listo para copiar';
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Contenido copiado.');
  } catch {
    setStatus('Copiado en la memoria local del navegador.');
  }
});
pasteAction.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    aiPrompt.value = text;
    setStatus('Texto pegado desde el portapapeles.');
  } catch {
    setStatus('No hay contenido para pegar en este momento.');
  }
});
deleteAction.addEventListener('click', () => {
  transcriptOutput.value = '';
  aiPrompt.value = '';
  setStatus('Contenido eliminado en la sesión actual.');
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
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
    if (action === 'guardar') {
      const fileName = audioPlayerTitle.textContent && audioPlayerTitle.textContent !== 'Audio sin seleccionar'
        ? `${audioPlayerTitle.textContent}.txt`
        : 'audio-sesion.mp3';
      state.files.push({
        file: { name: fileName, type: 'audio/mpeg', size: 512 },
        preview: '',
        icon: '🎵'
      });
      renderLibrary();
      updateStats();
    }
    if (action === 'copiar') {
      const source = transcriptOutput.value || aiPrompt.value || 'Contenido para copiar';
      navigator.clipboard.writeText(source).catch(() => {});
    }
    if (action === 'pegar') {
      navigator.clipboard.readText().then((text) => {
        if (text) {
          aiPrompt.value = text;
          setStatus('Texto pegado desde el portapapeles.');
        }
      }).catch(() => {});
    }
    if (action === 'enviar') {
      const output = document.getElementById('aiOutput');
      output.textContent = buildAiResponse(aiPrompt.value || transcriptOutput.value || 'Tema del archivo', 'Se envía al asistente IA con instrucciones específicas.');
      activateTab('asistente');
    }
    if (action === 'compartir') {
      const output = document.getElementById('aiOutput');
      output.textContent = 'Archivo preparado para compartir con la IA, la biblioteca y las demás pestañas del proyecto.';
      activateTab('asistente');
    }
    if (action === 'eliminar') {
      transcriptOutput.value = '';
      aiPrompt.value = '';
    }
  });
});

const speakTextBtn = document.getElementById('speakTextBtn');
speakTextBtn.addEventListener('click', async () => {
  const text = transcriptOutput.value || 'Texto a voz disponible en esta herramienta.';

  try {
    const result = await apiRequest('/tts', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });

    if (result.audioUrl) {
      audioPlayer.src = result.audioUrl;
      await audioPlayer.play().catch(() => {});
      setStatus('Audio generado con el servicio de texto a voz.');
      return;
    }
  } catch (error) {
    setStatus(`Texto a voz local: ${error.message}`);
  }

  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
    setStatus('Texto convertido a voz.');
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
loadStoredFiles();
activateTab(['inicio', 'biblioteca', 'centro', 'transcriptor', 'audios', 'documentos', 'asistente', 'imagenes', 'configuracion'].includes(initialTab) ? initialTab : 'inicio');
