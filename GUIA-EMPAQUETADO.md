# PILAR del estudiante: instalación y empaquetado

**Pre-lanzamiento:** los siguientes pasos describen empaquetado técnico, no certifican que el servicio esté listo para venta. Completar privacidad, condiciones, pagos, soporte y prueba de producción.

## PWA en teléfono o PC

1. Ejecuta `npm start`.
2. Abre `http://127.0.0.1:3000` en Chrome o Edge.
3. En el menú del navegador elige `Instalar PILAR del estudiante` o `Agregar a pantalla principal`.
4. Para que otros teléfonos la instalen, publica la carpeta con HTTPS. `127.0.0.1` solo funciona en el equipo donde corre el servidor.

El service worker guarda la interfaz base para abrirla sin conexión. Las rutas `/api` no se cachean: IA, transcripción y almacenamiento necesitan que el servidor esté activo.

## Ejecutable de Windows

Requisitos: Node.js 22 LTS o superior compatible y dependencias instaladas.

```powershell
npm install
npm run package:win
```

El script usa Node 22 para evitar una salida prematura de `electron-packager` en Node 24.

El instalador Windows se crea dentro de `dist-installer/`. Para abrir el modo escritorio durante desarrollo:

```powershell
npm run desktop
```

El modo escritorio inicia automáticamente `server.js`. Si el puerto 3000 está ocupado, cierra el proceso anterior o inicia la app web en otro puerto mediante `PORT=3010`.

En escritorio, el comprador pega su propia clave Gemini en Configuración; la aplicación la guarda en su perfil privado de Windows. No necesita crear `.env`, y tu clave nunca entra al instalador. Después del cobro y verificación, emite el código para el correo del comprador con `npm run license:issue -- desktop correo-del-comprador`. No distribuyas la clave privada del emisor ni el servidor local de Electron a Internet.

## Android como APK

Para una APK instalable se necesita una URL pública HTTPS. Una dirección local no puede ser usada por un teléfono externo.

Opción recomendada: Trusted Web Activity con Bubblewrap.

```powershell
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://TU-DOMINIO/manifest.json
bubblewrap build
```

Bubblewrap solicitará los datos de la aplicación y generará el proyecto Android. Después abre el APK resultante en Android Studio o instálalo en un dispositivo de prueba.

Alternativa sin compilar APK: publica la PWA con HTTPS y usa `Instalar aplicación` desde Chrome Android.

## iPhone

Publica la PWA con HTTPS, abre la URL en Safari y elige `Compartir > Añadir a pantalla de inicio`.

## Comprobación rápida

- Manifest: `http://127.0.0.1:3000/manifest.json`
- Service worker: `http://127.0.0.1:3000/sw.js`
- Salud del backend: `http://127.0.0.1:3000/api/health`

## Publicación web segura con Docker

El servidor puede publicarse en cualquier hosting que ejecute contenedores. La clave se configura en el hosting y no se incluye en el repositorio ni en el navegador.

```powershell
docker build -t pilar-estudiante .
docker run --rm -p 3000:3000 -e GEMINI_API_KEY=TU_CLAVE pilar-estudiante
```

Con Docker Compose para uso local, el almacenamiento queda en un volumen persistente:

```powershell
docker compose up -d --build
```

No subas `.env` a GitHub. En el hosting configura `GEMINI_API_KEY` como secreto y usa HTTPS delante del puerto `3000`.

Para publicar en Oracle Cloud Always Free, sigue [GUIA-DESPLIEGUE-OCI.md](GUIA-DESPLIEGUE-OCI.md). La guía prepara Docker Compose con almacenamiento persistente, HTTPS automático mediante Caddy y streaming sin búfer. Genera invitaciones/licencias individuales con `node tools/generate-license-codes.js invite 10` y `node tools/generate-license-codes.js license 10`; guarda sus salidas fuera del repo. OCI puede reclamar instancias inactivas y el nivel gratuito no garantiza disponibilidad.

Antes de invitar usuarios, valida HTTPS, registro, sesión tras reinicio, aislamiento entre dos cuentas, eliminación de cuenta, salud del modelo, una transcripción real y una generación de imagen real. El backend usa almacenamiento JSON local y requiere una única instancia con disco persistente; no escalar horizontalmente sin migrar usuarios, sesiones, licencias y archivos a servicios compartidos/transaccionales.
