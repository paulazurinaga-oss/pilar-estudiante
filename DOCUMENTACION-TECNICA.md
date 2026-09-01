# 🛠️ RESUMEN TÉCNICO - PILAR del estudiante

**Versión:** 1.0.0  
**Status:** ✅ Producción lista  
**Última actualización:** 2026-09-01

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

IA:
  - Google Gemini API (gemini-1.5-flash)
  - Fallbacks locales cuando API no está disponible

Desktop:
  - Electron (v31.7.4)
  - Almacenamiento persistente
  - Integración servidor interno

Almacenamiento:
  - Sistema de archivos local
  - Carpetas: uploads/, pdfs/
  - Persistencia en userData (Desktop)
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
├── script.js               ← Lógica frontend (1200+ líneas)
├── css/
│   └── styles.css          ← Estilos responsive
├── src/services/
│   ├── aiService.js        ← Integración Gemini
│   ├── appConfig.js        ← Configuración central
│   ├── storageService.js   ← Gestión de archivos
│   └── transcriptionQueue.js ← Cola de transcripciones
├── server.js               ← Backend Node.js (500+ líneas)
├── main.js                 ← Electron entry point
├── sw.js                   ← Service Worker
├── package.json
├── Dockerfile              ← Para Docker
├── docker-compose.yml      ← Orquestación Docker
├── render.yaml             ← Config para Render
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
| `GEMINI_API_KEY` | `AQ.Ab8RN6...` | ✅ Sí | Clave de Google Gemini |
| `GEMINI_MODEL` | `gemini-1.5-flash` | ✅ Sí | Modelo de IA |
| `GEMINI_TRANSCRIPTION_MODEL` | `gemini-1.5-flash` | ✅ Sí | Modelo para audio |
| `NODE_ENV` | `production` | ❌ No | Por defecto: `development` |
| `PORT` | `3000` | ❌ No | Por defecto: `3000` |
| `HOST` | `127.0.0.1` | ❌ No | Por defecto: `127.0.0.1` |

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
- En Render: Revisa Environment variables

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
- **Deployment:** GUIA-PUBLICAR-GITHUB-RENDER.md
- **GitHub:** https://github.com/paula27081974/pilar-estudiante

---

## ✅ CHECKLIST DE PRODUCCIÓN

- [x] Variables de entorno configuradas
- [x] .env en .gitignore
- [x] Rate limiting activo
- [x] Manejo de errores completo
- [x] Fallbacks de IA implementados
- [x] HTTPS (en Render)
- [x] Logo correcto (P de PILAR)
- [x] Modelo Gemini válido
- [x] Tests manuales completados
- [x] Documentación completa

---

*Documento técnico: 2026-09-01*  
*PILAR v1.0.0 - Production Ready*
