# Despliegue de PILAR en Render Free con Firebase

Render ejecuta el servidor web; Firebase Authentication, Firestore y Realtime Database proporcionan cuentas y almacenamiento persistente. El servicio web no usa el disco efímero de Render para datos de usuario.

## Límites gratuitos

- Render Free puede suspender el servicio tras 15 minutos sin solicitudes entrantes; la primera visita posterior puede esperar el arranque en frío. Su cuota mensual de horas gratuitas y límites pueden cambiar. No es un SLA ni disponibilidad continua.
- Una tarea en segundo plano no puede mantener despierto un servicio suspendido. La app guarda el trabajo en Firestore y lo reanuda al reiniciar Render; mientras la pestaña está abierta, el navegador consulta el estado periódicamente.
- Las cargas web en Render están limitadas a 50 MB para mantener acotado el uso de memoria del servicio gratuito; la migración de archivos admite hasta 100 MB por archivo.
- Firebase Spark tiene cuotas acotadas que pueden cambiar. Comprueba los precios actuales antes de publicar: Firestore ofrece cuotas gratuitas diarias y almacenamiento limitado; Realtime Database tiene límites de almacenamiento y transferencia. PILAR no usa Firebase Cloud Storage.
- El procesamiento asíncrono evita esperar a Gemini en la solicitud inicial, pero no elimina los límites de carga, ancho de banda, cuotas de Gemini/Firebase ni el tiempo de arranque en frío.

## 1. Crear y configurar Firebase

1. Crea un proyecto Firebase y habilita **Authentication > Email/Password**, Cloud Firestore y Realtime Database.
2. Crea una cuenta de servicio del servidor con los permisos mínimos necesarios para Authentication, Firestore y Realtime Database. Guarda su archivo JSON fuera del repositorio.
3. Obtén la Web API Key del proyecto desde la configuración de Firebase. El servidor la usa para intercambiar credenciales de Email/Password; no se envía al navegador.
4. Aplica las reglas configuradas en [firebase.json](./firebase.json), [firestore.rules](./firestore.rules) y [database.rules.json](./database.rules.json). El acceso cliente queda denegado: la app opera mediante el servidor autenticado con Firebase Admin.

## 2. Migrar un respaldo de Render

Antes de reemplazar o reiniciar el servicio antiguo, exporta la carpeta `storage` completa y conserva el respaldo cifrado. Incluye cuentas, archivos, carpetas, compras y licencias; no publiques ni adjuntes ese respaldo al repositorio.

Con Node.js 22 y las dependencias instaladas, define temporalmente las variables Firebase y la ruta al respaldo:

```powershell
$env:PILAR_LEGACY_STORAGE = "C:\ruta-segura\storage"
npm run migrate:render-firebase -- --dry-run
npm run migrate:render-firebase
```

La migración copia perfiles y datos comerciales a Firestore, archivos a Realtime Database, y almacena el hash scrypt legado en `legacyAuth`. No copia sesiones. En el primer inicio de sesión, el servidor valida la contraseña existente, crea la cuenta Firebase Authentication conservando el ID anterior y elimina el registro de hash legado. Mantén el respaldo original cifrado hasta comprobar cuentas, archivos y compras.

Si una cuenta se autentica en Firebase con un ID distinto al ID legado, la migración se detiene por seguridad; no borres manualmente el registro ni crees una cuenta duplicada.

## 3. Crear el servicio Render

1. Conecta el repositorio a Render y crea un **Web Service** con `render.yaml` o usa **New > Blueprint**.
2. Mantén el plan `Free`; no configures disco persistente ni habilites servicios de pago.
3. En **Environment**, completa los valores marcados `sync: false`: credenciales Firebase, `GEMINI_API_KEY`, URL pública y códigos de invitación/licencia. Para la cuenta de servicio puedes configurar `FIREBASE_SERVICE_ACCOUNT_JSON` con el contenido JSON completo; alternativamente, configura `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY`. También son obligatorias `FIREBASE_DATABASE_URL` y `FIREBASE_WEB_API_KEY`. Nunca pegues la credencial en el código, en un commit ni en un mensaje.
4. Deja `PILAR_OPEN_REGISTRATION=false` y configura códigos de invitación individuales antes de habilitar registros. No compartas los secretos en logs o commits.
5. Despliega y comprueba `https://<tu-servicio>.onrender.com/api/health`. Después prueba registro, inicio/cierre de sesión, almacenamiento, eliminación de cuenta, compra (si está configurada), mapa visual y transcripción.

Render proporciona HTTPS para el dominio `onrender.com`; no hace falta Caddy ni un proxy adicional. El servidor obliga a usar Firebase cuando detecta `RENDER_SERVICE_ID`, y falla al iniciar si faltan variables Firebase, en lugar de guardar silenciosamente en el disco efímero.

## 4. Operación y restauración

- Revisa los límites de Firestore, Realtime Database, Render y Gemini con regularidad; las cuotas gratuitas no son ilimitadas.
- En la pestaña abierta, mapas e infografías consultan su trabajo hasta finalizar. Las transcripciones también exponen progreso y cancelación. Los trabajos se guardan en Firestore y se reanudan cuando Render vuelve a iniciar.
- Exporta periódicamente Firestore y Realtime Database a un lugar cifrado separado. Prueba la restauración y no almacenes respaldos en el repositorio.
- Si Firebase alcanza cuota o está indisponible, la aplicación comunica el error; no cambia a almacenamiento local.

El despliegue no puede verificarse contra un proyecto Firebase real sin las credenciales del operador. Ejecuta las pruebas locales antes de configurar el Blueprint y completa la prueba de aceptación con un proyecto de prueba y cuotas disponibles.
