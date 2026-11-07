# 🛠️ RESUMEN TÉCNICO - PILAR del estudiante

**Versión:** 1.0.0  
**Status:** Pre-lanzamiento; Firebase real y credenciales de despliegue deben verificarse por el operador.
**Última actualización:** 2026-11-07

---

## 📋 ARQUITECTURA

### Stack Tecnológico
```
Frontend:
  - HTML5 / CSS3 / JavaScript (Vanilla)
  - PWA (Progressive Web App)
  - Service Worker para offline
  - Responsive design

Backend:
  - Node.js 22 LTS
  - HTTP puro (sin Express, optimizado)
  - Manejo de multipart/form-data
  - Rate limiting integrado
  - Firebase Admin en despliegue Render (Auth, Firestore, Realtime Database)
  - Persistencia local en escritorio/desarrollo

IA:
  - Google Gemini API (gemini-flash-latest)
  - Trabajos asíncronos durables para mapas, imágenes y transcripciones

Desktop:
  - Electron (v31.7.4)
  - Almacenamiento persistente
  - Integración servidor interno

Almacenamiento:
  - Firestore: perfiles, carpetas, licencias, pagos y trabajos
  - Realtime Database: archivos en fragmentos de 5 MB
  - Sistema de archivos local para desarrollo y Desktop
```

---

## 🔌 ENDPOINTS API

### Health Check
```
GET /api/health
Response: {
  "ok": true,
  "app": "PILAR del estudiante",
  "provider": "gemini",
  "providerConfigured": true,
  "status": "healthy",
  "timestamp": "2026-09-01T..."
}
```

### Chat IA
```
POST /api/ai/chat
Body: {
  "prompt": "Explica fotosíntesis",
  "context": "Biología 10º grado"
}
Response: {
  "content": "...",
  "fallback": false
}
Rate limit: 30 req/min por cliente
```

### Transcripción
```
POST /api/transcribe
Body: multipart/form-data (audio file)
Response: {
  "jobId": "uuid",
  "status": "queued"
}

GET /api/transcribe/jobs/{jobId}
Response: {
  "id": "uuid",
  "status": "completed|processing",
  "text": "...",
  "progress": 0-100
}
Rate limit: 5 req/10min por cliente
```

### Mapas e imágenes en segundo plano
```
POST /api/generate-infographic
POST /api/ai/image
Response: HTTP 202 { "jobId": "uuid", "status": "queued" }

GET /api/ai/jobs/{jobId}
Response: { "id": "uuid", "status": "queued|processing|completed|failed", "progress": 0-100, "result": {...} }
```

### Text-to-Speech
```
POST /api/tts
Body: {
  "text": "Texto para leer",
  "voice": "alloy"
}
Response: {
  "url": "http://...",
  "mimeType": "audio/mpeg"
}
```

### Almacenamiento
```
POST /api/storage/text
Body: {
  "fileName": "mi-nota.txt",
  "content": "contenido..."
}

GET /api/storage/files
Response: [
  {
    "name": "archivo.txt",
    "size": 1024,
    "type": "text",
    "relativePath": "uploads/archivo.txt"
  }
]

DELETE /api/storage/files/{name}
```

---

## 📁 ESTRUCTURA DEL PROYECTO

```
pilar-estudiante/
├── index.html              ← PWA principal
├── script.js               ← Lógica frontend y renderizado de diagramas Mermaid
├── css/
│   └── styles.css          ← Estilos responsive
├── src/services/
│   ├── aiService.js        ← Integración Gemini con hasta 3 reintentos exponenciales ante errores temporales
│   ├── appConfig.js        ← Configuración central
│   ├── storageService.js   ← Gestión de archivos
│   ├── transcriptionQueue.js ← Cola de transcripciones local
│   ├── firebaseService.js  ← Auth y persistencia remota
│   └── aiJobQueue.js       ← Cola local para desarrollo/escritorio
├── server.js               ← Backend Node.js y CSP que permite cargar Mermaid desde jsDelivr
├── main.js                 ← Electron entry point
├── sw.js                   ← Service Worker
├── package.json
├── Dockerfile              ← Para Docker
├── docker-compose.yml      ← Orquestación Docker
├── render.yaml             ← Web Service Render Free
├── firestore.rules         ← Bloquea acceso cliente directo
├── database.rules.json     ← Bloquea acceso cliente directo
├── manifest.json           ← PWA manifest
├── .env.example            ← Template de env
├── .gitignore              ← Ignora claves y builds
└── storage/                ← (Local, no se sube)
    ├── uploads/
    └── pdfs/
```

---

## ⚙️ CONFIGURACIÓN

### Variables de Entorno

| Variable | Ejemplo | Requerido | Notas |
|----------|---------|-----------|-------|
| `GEMINI_API_KEY` | configurada localmente | ✅ Sí | Clave de Google Gemini |
| `GEMINI_MODEL` | `gemini-flash-latest` | ✅ Sí | Modelo de IA |
| `GEMINI_TRANSCRIPTION_MODEL` | `gemini-flash-latest` | ✅ Sí | Modelo para audio |
| `NODE_ENV` | `production` | ❌ No | Por defecto: `development` |
| `PORT` | `3000` | ❌ No | Por defecto: `3000` |
| `HOST` | `127.0.0.1` | ❌ No | Render: `0.0.0.0` |
| `PILAR_GEMINI_TIMEOUT_MS` | `600000` | ❌ No | De 1000 a 900000 ms; por defecto 10 minutos |
| `PILAR_PERSISTENCE` | `firebase` | Render | Firebase requerido en Render; local por defecto |
| `FIREBASE_PROJECT_ID` | — | Render | ID del proyecto Firebase |
| `FIREBASE_CLIENT_EMAIL` | — | Render | Cuenta de servicio del backend |
| `FIREBASE_PRIVATE_KEY` | — | Render | Clave privada de servicio, solo servidor |
| `FIREBASE_DATABASE_URL` | — | Render | URL de Realtime Database |
| `FIREBASE_WEB_API_KEY` | — | Render | Clave de Identity Toolkit del proyecto |

### Instalación de Dependencias

```bash
npm install
```

Dependencias:
- `dotenv` - Manejo de variables de entorno
- `ffmpeg-static` - Para procesamiento de audio
- `electron` - Framework desktop
- `electron-packager` - Para empaquetar como .exe

---

## 🚀 COMANDOS

### Desarrollo
```bash
# Versión web (PWA)
npm start

# Versión desktop (Electron)
npm run desktop

# Tests
npm run test
```

### Producción
```bash
# Empaquetar como .exe (Windows)
npm run package:win

# Build Docker
docker build -t pilar .
docker run -p 3000:3000 -e GEMINI_API_KEY=... pilar

# Con Docker Compose
docker compose up -d --build

# Migración desde una exportación anterior de Render
npm run migrate:render-firebase -- --dry-run
npm run migrate:render-firebase
```

---

## 🔐 SEGURIDAD

### Headers HTTP
```
Content-Type: application/json
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

### Rate Limiting
- IA Chat: 30 solicitudes/minuto por IP
- Transcripción: 5 solicitudes/10 minutos por IP

### Protección de Datos
- `.env` con claves API NO se sube a GitHub
- Storage local encriptado en Desktop
- Sesiones sin estado (stateless)
- Validación de entrada en todos los endpoints

---

## 📊 RENDIMIENTO

### Optimizaciones
- Service Worker para offline
- Cacheo de assets estáticos
- Compresión de respuestas JSON
- Lazy loading de imágenes
- Minificación de CSS/JS (opcional)

### Recursos
- Size inicial: ~2 MB (sin node_modules)
- Build final .exe: ~200 MB (con Chromium)
- RAM en Desktop: ~150-300 MB (según uso)

---

## 🧪 TESTING

### Verificado
- ✅ API /api/health
- ✅ Chat con Gemini fallback
- ✅ Transcripción con queue
- ✅ Almacenamiento de archivos
- ✅ Interfaz web responsive
- ✅ Electron startup y shutdown
- ✅ PWA offline mode

### No incluido
- ❌ Unit tests (usar Jest o Mocha si necesario)
- ❌ E2E tests (usar Playwright si necesario)

---

## 📈 ESCALABILIDAD

### Mejoras futuras
1. Base de datos (MongoDB/PostgreSQL)
2. Autenticación con JWT
3. Pagos (Stripe/MercadoPago)
4. Estadísticas de usuario
5. Analytics (Sentry/LogRocket)
6. CDN para assets
7. Versionado de API

---

## 🐛 TROUBLESHOOTING

### "GEMINI_API_KEY not configured"
- Verifica `.env` existe
- Verifica clave no está vacía
- En el servidor: revisa los secretos de `.env` sin copiarlos a logs o repositorios

### "Cannot find module 'electron'"
```bash
npm install
```

### Electron no abre
- Verifica que Node.js 22+ está instalado
- Intenta: `npm run desktop -- --verbose`

### Puerto 3000 ocupado
```bash
PORT=3010 npm start
```

---

## 📞 SOPORTE

- **Documentación:** GUIA-EMPAQUETADO.md, INFORME-TESTING-PILAR.md
- **Deployment:** GUIA-DESPLIEGUE-RENDER.md
- **GitHub:** https://github.com/paula27081974/pilar-estudiante

---

## ✅ CHECKLIST DE PRODUCCIÓN

- [x] Variables de entorno configuradas
- [x] .env en .gitignore
- [x] Rate limiting activo
- [x] Manejo de errores completo
- [x] Fallbacks de IA implementados
- [ ] Configurar proyecto Firebase y variables secretas reales antes de desplegar
- [x] Logo correcto (P de PILAR)
- [x] Modelo Gemini válido
- [x] Tests manuales completados
- [x] Documentación completa

---

*Documento técnico: 2026-09-01*  
*PILAR v1.0.0 - Documento histórico; no implica certificación de producción.*
