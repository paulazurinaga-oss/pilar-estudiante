# Aviso de privacidad de PILAR del estudiante

**Borrador para revisión local. No publicar ni usar como aviso definitivo sin completar los campos entre corchetes y obtener revisión legal en los países donde se ofrecerá el servicio.**

- Responsable del tratamiento: [nombre legal o razón social, domicilio y contacto].
- Contacto de privacidad: [correo de contacto].
- Fecha de vigencia: [fecha].

## Datos tratados

PILAR puede tratar nombre, correo electrónico, hash de contraseña, datos de sesión, fecha de alta y vencimiento de la prueba, licencias canjeadas, archivos que la persona sube, carpetas y materiales de estudio guardados, y solicitudes enviadas a funciones de IA. Las contraseñas no se guardan en texto plano. Los tokens de sesión se guardan como hashes.

## Finalidades y proveedores

Los datos de cuenta se usan para autenticar, administrar la prueba y las licencias, proteger el servicio y separar los archivos por cuenta. Al pedir una respuesta, transcripción o imagen, el contenido necesario se envía a Google Gemini usando la clave configurada por el operador. Se aplican además las condiciones y políticas vigentes de Google. En el despliegue autogestionado descrito en `GUIA-DESPLIEGUE-OCI.md`, Oracle Cloud Infrastructure proporciona la VM y el disco; el operador administra el sistema, los respaldos y la disponibilidad. Completar la región y los proveedores efectivamente utilizados antes de publicar este aviso.

Si se habilita la compra web, PILAR envía a Mercado Pago el correo y los datos mínimos del pedido para crear el checkout. No recibe ni almacena tarjetas. Guarda el ID del pedido/pago, estado, importe y moneda para activar la licencia tras confirmar el pago.

No se debe subir información sensible, datos de salud, datos de terceros ni material que la persona no tenga derecho a procesar. PILAR no debe promocionarse como servicio apropiado para menores hasta revisar los requisitos legales, obtener los consentimientos necesarios y documentar el tratamiento correspondiente.

## Conservación y eliminación

Los datos de cuenta y archivos se conservan mientras la cuenta exista y el servicio esté activo. La persona puede solicitar o iniciar la eliminación de su cuenta desde Configuración; el servicio elimina la cuenta, sus sesiones y los archivos/carpeta de usuario del almacenamiento de la aplicación. Copias de seguridad, registros del hosting o del proveedor de IA pueden tener plazos distintos conforme a sus políticas.

## Seguridad y transferencias

PILAR aplica contraseñas derivadas con scrypt, sesiones HttpOnly, aislamiento de archivos por cuenta y controles básicos de abuso. Ningún sistema conectado a Internet puede garantizar seguridad absoluta. El alojamiento o los proveedores de IA pueden procesar información desde otros países; el operador debe confirmar las ubicaciones, salvaguardas y obligaciones aplicables antes de ofrecer el servicio.

## Derechos y reclamaciones

Para ejercer derechos de acceso, rectificación, eliminación, oposición u otros derechos aplicables, contactar a [correo de contacto]. También puede presentarse una reclamación ante [autoridad competente, según país]. Completar este apartado con asesoría local antes del lanzamiento.

## Cookies y almacenamiento local

La aplicación utiliza una cookie de sesión HttpOnly, SameSite y de duración limitada. La interfaz puede guardar archivos estáticos de la PWA en la caché del navegador; las API y rutas de archivos personales no se guardan en la caché de la PWA.
