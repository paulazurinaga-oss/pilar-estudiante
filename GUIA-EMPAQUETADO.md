# PILAR del estudiante: instalación y empaquetado

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

El resultado se crea dentro de `dist/`. Para abrir el modo escritorio durante desarrollo:

```powershell
npm run desktop
```

El modo escritorio inicia automáticamente `server.js`. Si el puerto 3000 está ocupado, cierra el proceso anterior o inicia la app web en otro puerto mediante `PORT=3010`.

En el paquete final, coloca `.env` en la misma carpeta que `PILAR.exe`. Electron pasa esa ruta al servidor interno y la configuración se carga antes de abrir la ventana. No incluyas `.env` en repositorios ni distribuyas una clave compartida.

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

Con Docker Compose, el almacenamiento queda en un volumen persistente:

```powershell
docker compose up -d --build
```

No subas `.env` a GitHub. En el hosting configura `GEMINI_API_KEY` como secreto y usa HTTPS delante del puerto `3000`.

Para Render, sube el proyecto a un repositorio privado de GitHub y crea un nuevo Blueprint usando `render.yaml`. Render pedirá el valor de `GEMINI_API_KEY` como secreto. El plan configurado incluye un disco persistente de 10 GB para conservar archivos.

Después configura el dominio HTTPS del hosting hacia el puerto `3000`. Comprueba `https://TU-DOMINIO/api/health` antes de compartir el enlace. Para producción, guarda también el almacenamiento en un volumen persistente para que las cargas sobrevivan a los reinicios del contenedor.
