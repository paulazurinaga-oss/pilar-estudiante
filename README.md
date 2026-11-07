# PILAR del estudiante 📚

**Aplicación web y desktop inteligente para estudio con IA**

[![Status](https://img.shields.io/badge/status-pre--release-orange)]()
[![Version](https://img.shields.io/badge/version-1.0.0-blue)]()
[![License](https://img.shields.io/badge/license-ISC-green)]()

---

## 🎯 ¿Qué es PILAR?

PILAR es una plataforma de estudio inteligente que integra:
- 📝 **Asistente IA** con Google Gemini
- 🎵 **Transcripción de audio** automática
- 📂 **Gestión de recursos** (apuntes, PDFs, audios)
- 💬 **Chat académico** con manejo transparente de fallos
- 🖥️ **Versión web** (PWA) y **Desktop** (Electron)

El despliegue web previsto es Render Free con Firebase. El plan gratuito puede suspender el servicio y tanto Firebase como Gemini tienen cuotas limitadas; no se garantiza disponibilidad continua. Antes de migrar una instalación existente, exporta y migra el almacenamiento como indica [GUIA-DESPLIEGUE-RENDER.md](GUIA-DESPLIEGUE-RENDER.md).

---

## 🚀 Empezar rápido

### Ejecutar en desarrollo
```bash
# Clonar repositorio
git clone https://github.com/paula27081974/pilar-estudiante.git
cd pilar-estudiante

# Instalar dependencias
npm install

# Ejecutar versión web
npm start

# O ejecutar versión desktop
npm run desktop
```

---

## ✨ Características

### 🧠 Asistente IA
- Responde preguntas académicas
- Crea resúmenes, mapas conceptuales, fichas
- Errores externos comunicados claramente, sin fabricar contenido como respuesta IA
- Modelos configurables por variables de entorno

### 🎵 Transcriptor de Audio
- Convierte audios a texto automáticamente
- Procesa en background con cola de trabajos
- Soporta múltiples formatos

### 📂 Biblioteca Digital
- Organiza apuntes, PDFs, imágenes, audios
- Búsqueda y filtrado rápido
- Descarga y gestión de archivos

### 📱 Multiplataforma
- **Web:** PWA cachea la interfaz estática; los datos privados requieren conexión
- **Desktop:** Electron con almacenamiento persistente
- **Mobile:** Compatible con navegadores

### 🔐 Seguridad
- Claves API protegidas
- Rate limiting contra abuso
- Headers HTTP seguros
- Validación de entrada
- Registro con invitación en producción, Firebase Authentication y sesiones HttpOnly; scrypt se usa solo para validar cuentas heredadas durante su migración
- Almacenamiento separado por cuenta
- Sesiones de Firebase Authentication en cookies HttpOnly; Firestore y Realtime Database solo se acceden desde el servidor

---

## 🛠️ Stack Tecnológico

**Frontend:**
- HTML5, CSS3, JavaScript (vanilla)
- PWA con Service Worker
- Electron para Desktop

**Backend:**
- Node.js 22 LTS
- HTTP puro (sin frameworks)
- Firebase Authentication y Firestore para cuentas/datos estructurados
- Realtime Database para archivos en fragmentos
- Persistencia local para desarrollo y escritorio

**IA:**
- Google Gemini API (gemini-flash-latest)
- Reintentos limitados para fallos temporales

### Estado comercial

La prueba de 7 días bloquea IA al vencer. La web tiene Checkout Pro de compra única, apagado hasta configurar credenciales, precio y HTTPS; el escritorio acepta licencias firmadas ligadas al correo y usa la clave Gemini propia del comprador. No hay facturación, recuperación/verificación de correo ni soporte comercial integrados.

Los borradores de [PRIVACIDAD.md](PRIVACIDAD.md) y [CONDICIONES-DE-USO.md](CONDICIONES-DE-USO.md) requieren completar los datos del operador, contactos, condiciones económicas y revisión legal local. Consulta [PRELANZAMIENTO-COMERCIAL.md](PRELANZAMIENTO-COMERCIAL.md) para la lista completa de bloqueantes.

**Deployment:**
- Render Free con persistencia Firebase; tareas visuales y transcripciones se procesan en segundo plano

---

## 📋 API Endpoints

### Health Check
```http
GET /api/health
```
Respuesta: `{ "ok": true, "status": "healthy" }`

### Chat IA
```http
POST /api/ai/chat
Content-Type: application/json

{
  "prompt": "Explica fotosíntesis",
  "context": "Biología 10º"
}
```

### Transcribir Audio
```http
POST /api/transcribe
Content-Type: multipart/form-data

[audio file]
```

Las rutas de transcripción y generación visual responden `202 Accepted` con un `jobId`; consulta `GET /api/transcribe/jobs/{jobId}` o `GET /api/ai/jobs/{jobId}` para progreso y resultado.

Ver documentación completa en [DOCUMENTACION-TECNICA.md](DOCUMENTACION-TECNICA.md)

---

## ⚙️ Configuración

### Variables de Entorno
```env
GEMINI_API_KEY=tu_api_key_aqui
GEMINI_MODEL=gemini-flash-latest
NODE_ENV=production
PORT=3000
```

En Render también se requieren `PILAR_PERSISTENCE=firebase` y las variables privadas `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_DATABASE_URL` y `FIREBASE_WEB_API_KEY`. Ver `.env.example` y [la guía de Render/Firebase](GUIA-DESPLIEGUE-RENDER.md).

---

## 📦 Instalación

### Requisitos
- Node.js 22 LTS o superior
- npm o yarn

### Pasos
```bash
# 1. Clonar
git clone https://github.com/paula27081974/pilar-estudiante.git
cd pilar-estudiante

# 2. Instalar
npm install

# 3. Configurar
cp .env.example .env
# Edita .env con tu GEMINI_API_KEY

# 4. Ejecutar
npm start

# 5. Abrir
# Navegador: http://127.0.0.1:3000
```

---

## 🧪 Testing

### Versión Web
```bash
npm start
# Abre: http://127.0.0.1:3000
```

### Versión Desktop
```bash
npm run desktop
```

### Empaquetar como .exe
```bash
npm run package:win
# Resultado: dist/PILAR-win32-x64/PILAR.exe
```

### Verificar API
```bash
curl http://127.0.0.1:3000/api/health
```

---

## 🐳 Docker local (opcional)

```bash
# Build
docker build -t pilar .

# Run
docker run -p 3000:3000 \
  -e GEMINI_API_KEY=tu_clave \
  pilar

# Con Compose
docker compose up -d --build
```

Docker es opcional para desarrollo. Para el despliegue web, usa [GUIA-DESPLIEGUE-RENDER.md](GUIA-DESPLIEGUE-RENDER.md); no publiques en Render sin configurar Firebase y migrar primero los datos que deban conservarse.

---

## 📖 Documentación

| Archivo | Descripción |
|---------|-------------|
| [INICIO-RAPIDO.md](INICIO-RAPIDO.md) | 3 pasos para publicar |
| [GUIA-DESPLIEGUE-RENDER.md](GUIA-DESPLIEGUE-RENDER.md) | Despliegue Render Free, Firebase y migración |
| [DOCUMENTACION-TECNICA.md](DOCUMENTACION-TECNICA.md) | API, arquitectura, troubleshooting |
| [INFORME-TESTING-PILAR.md](INFORME-TESTING-PILAR.md) | Testing completo |
| [GUIA-EMPAQUETADO.md](GUIA-EMPAQUETADO.md) | Cómo empaquetar app |

---

## 🚨 Troubleshooting

### "GEMINI_API_KEY not configured"
```bash
# Verifica que .env existe y tiene la clave
cat .env | grep GEMINI_API_KEY

# Si falta, agrega tu clave:
echo "GEMINI_API_KEY=tu_clave_aqui" >> .env
```

### "Cannot find module 'electron'"
```bash
npm install
npm run desktop
```

### "Port 3000 already in use"
```bash
PORT=3010 npm start
```

Ver más en [DOCUMENTACION-TECNICA.md - Troubleshooting](DOCUMENTACION-TECNICA.md#-troubleshooting)

---

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor:
1. Fork el repositorio
2. Crea una rama (`git checkout -b feature/nueva-feature`)
3. Commit tus cambios (`git commit -m 'Add: nueva feature'`)
4. Push a la rama (`git push origin feature/nueva-feature`)
5. Abre un Pull Request

---

## 📝 Licencia

Este proyecto está bajo la licencia ISC.

---

## 👤 Autor

**Paula**  
- GitHub: [@paula27081974](https://github.com/paula27081974)
- Email: paula27081974@gmail.com

---

## 🔗 Links útiles

- **Repositorio:** https://github.com/paula27081974/pilar-estudiante
- **Gemini API:** https://ai.google.dev
- **Render:** https://render.com/
- **Electron:** https://www.electronjs.org

---

## 📊 Status

| Componente | Status | Detalles |
|-----------|--------|----------|
| Web PWA | ✅ | Funcional y online |
| Desktop (Electron) | ✅ | Funcional, descargable |
| IA (Gemini) | ✅ | Conectada y respondiendo |
| API Backend | ✅ | Todos endpoints OK |
| Testing | ✅ | Completado |
| Seguridad | ✅ | Rate limiting, headers seguros |
| Documentación | ✅ | Completa y actualizada |

---

**¡Gracias por usar PILAR! 📚✨**

*Versión 1.0.0 - Producción ready*
