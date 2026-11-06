# Despliegue gratuito autogestionado en Oracle Cloud

Esta configuración ejecuta la aplicación en una VM Always Free, sin una plataforma HTTP intermedia que corte las respuestas largas. La app y el navegador siguen usando las mismas rutas relativas (`/api/...`); Caddy publica la interfaz y la API bajo un único dominio, termina HTTPS y reenvía el streaming sin almacenarlo en búfer. Las transcripciones siguen usando la cola existente y Gemini admite solicitudes de hasta diez minutos por defecto.

## Límites importantes

- Usa únicamente recursos identificados como **Always Free**. Oracle puede no tener capacidad gratuita disponible en la región elegida y exige un medio de pago válido para verificar la cuenta.
- OCI puede reclamar instancias Always Free consideradas inactivas durante siete días. Por eso esta opción elimina el límite de tiempo de respuesta del proxy, pero no garantiza disponibilidad ininterrumpida. No se debe presentar como SLA ni como servicio comercial listo.
- La cuota sin cargo y la disponibilidad pueden cambiar. Una IPv4 pública, DNS u otros recursos pueden tener precio aparte; confirma el costo en [la página oficial de precios](https://www.oracle.com/cloud/price-list/) antes de crear recursos. No actives recursos de pago y establece alertas/cuotas.
- Una VM usa archivos JSON y disco local: ejecuta una sola instancia. Las tareas en curso no sobreviven a un reinicio, aunque las cuentas y archivos permanecen en el volumen Docker. Mantén copias de seguridad cifradas fuera de la VM.
- Para HTTPS se necesita un nombre DNS. Puedes usar un dominio propio o un subdominio gratuito de un proveedor DNS dinámico, sujeto a sus condiciones y disponibilidad.

Oracle publica los recursos y condiciones vigentes en [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) y [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/).

## 1. Crear la VM y configurar la red

1. Crea una cuenta OCI y una instancia Linux **Always Free** en tu región principal. Si hay capacidad, una VM Ampere A1 de hasta 2 OCPU y 12 GB de RAM es adecuada para ejecutar Docker y FFmpeg. Confirma la etiqueta Always Free antes de aprovisionar.
2. Asigna una IPv4 pública y apunta el registro DNS del dominio/subdominio a esa dirección. Antes, confirma en la estimación de OCI si esa dirección está incluida en tu cuota Always Free o genera cargos.
3. En las reglas de red de OCI permite entrada TCP 80 y 443 desde Internet. Permite SSH (TCP 22) solo desde tu IP; no abras el puerto 3000.
4. Conéctate por SSH, actualiza el sistema e instala Docker Engine y el plugin Docker Compose desde las instrucciones oficiales de Docker para la distribución elegida. Habilita Docker al iniciar el sistema.
5. Si el firewall del sistema está activo, permite también 80/443 y SSH solo desde tu IP. No expongas el puerto interno de PILAR.

## 2. Preparar el código y los secretos

Clona el repositorio en la VM y crea el archivo `.env` a partir de `.env.example`. No subas el `.env` a GitHub.

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Configura como mínimo:

```dotenv
GEMINI_API_KEY=...
PILAR_GEMINI_TIMEOUT_MS=600000
PILAR_DATA_PATH=/data/storage
PILAR_OPEN_REGISTRATION=false
PILAR_REGISTRATION_CODES=...
PILAR_LICENSE_CODES=...
PILAR_PUBLIC_URL=https://tu-subdominio.example
CADDY_DOMAIN=tu-subdominio.example
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
```

Usa códigos de invitación/licencia aleatorios y guárdalos fuera del repositorio. Si decides habilitar el registro abierto, establece `PILAR_OPEN_REGISTRATION=true` deliberadamente y considera que la app no tiene verificación de correo ni recuperación de contraseña. El precio y los secretos de Mercado Pago solo deben configurarse si se completaron y probaron los requisitos comerciales correspondientes.

El timeout de Gemini admite valores enteros de 1000 a 900000 ms; si se omite, es de 600000 ms. No cambia los límites de cuota ni de duración impuestos por Google Gemini.

## 3. Iniciar y verificar

Desde la carpeta del proyecto:

```bash
sudo docker compose --env-file .env -f docker-compose.production.yml up -d --build
sudo docker compose --env-file .env -f docker-compose.production.yml ps
```

Confirma en `https://tu-subdominio.example/api/health` que la respuesta indique `ok: true` y `providerConfigured: true`. Caddy solicita y renueva automáticamente el certificado TLS cuando el DNS apunta a la VM y los puertos 80/443 son accesibles. Después prueba registro, inicio/cierre de sesión, carga de un archivo, chat, mapa conceptual y una transcripción larga con una cuenta Gemini que tenga cuota disponible.

Los assets de la PWA y todas las API se sirven desde el mismo origen; no hay que introducir una URL separada ni cambiar rutas en el navegador. El puerto 3000 permanece interno a la red de Docker. El proxy de Caddy tiene streaming habilitado y no impone un timeout de respuesta.

## 4. Operación y datos

- Ver registros: `sudo docker compose --env-file .env -f docker-compose.production.yml logs -f pilar caddy`.
- Actualizar una versión: `git pull` y luego `sudo docker compose --env-file .env -f docker-compose.production.yml up -d --build`.
- Reiniciar los contenedores: `sudo docker compose --env-file .env -f docker-compose.production.yml restart`.
- El volumen `pilar-data` guarda usuarios, sesiones, licencias y archivos. Los volúmenes `caddy-data` y `caddy-config` guardan certificados y configuración TLS.
- Programa y prueba respaldos cifrados fuera de la VM para los tres volúmenes. No elimines volúmenes al actualizar ni ejecutes `docker compose down -v`.
- No escales a varias instancias: cuentas, sesiones, limitación de uso y cola de transcripción se mantienen localmente.

Esta preparación no crea la cuenta OCI, reserva la VM, configura DNS ni valida la cuota real de Gemini; esos pasos dependen de la cuenta y los secretos del operador.
