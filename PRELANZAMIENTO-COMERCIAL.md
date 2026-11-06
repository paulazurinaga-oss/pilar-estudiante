# PILAR del estudiante: pre-lanzamiento comercial

Este checklist distingue el código probado localmente de las tareas que requieren servicios externos o decisiones del operador. **No anunciar ventas ni abrir el registro al público hasta cerrar las tareas obligatorias.**

## Hecho y comprobado localmente

- [x] Contraseñas derivadas con scrypt; cookies de sesión HttpOnly, SameSite y Secure detrás de HTTPS.
- [x] Sesiones persistentes entre reinicios, almacenadas como hashes en el disco persistente.
- [x] Invitaciones individuales de un solo uso y licencias desktop Ed25519 ligadas al correo.
- [x] Prueba de siete días aplicada desde el servidor.
- [x] Archivos y carpetas aislados por usuario; el usuario puede borrar su cuenta y sus datos.
- [x] Limitación de uso, defensas básicas CSRF/CSP y rechazo de archivos/rutas privados.
- [x] Pruebas automatizadas de autenticación, persistencia, aislamiento, licencia y fallos simulados de Gemini.
- [x] Instalador Windows sin `.env`, datos, tests ni generador de códigos.

## Obligatorio antes de aceptar clientes

1. **Definir condiciones:** nombre legal, precio ARS, impuestos, reembolsos, soporte, facturación y política de entrega; completar y revisar los documentos legales.
2. **Web:** Checkout Pro está integrado para licencia única, pero permanece apagado hasta configurar `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `PILAR_WEB_PRICE_ARS` (entero en ARS) y `PILAR_PUBLIC_URL` (HTTPS real). Activa la cuenta solo después de firma webhook válida y consulta de pago aprobado.
3. **Completar documentos:** reemplazar todos los campos `[entre corchetes]` en `PRIVACIDAD.md` y `CONDICIONES-DE-USO.md`, y solicitar revisión legal/fiscal local. Actualmente son borradores.
4. **Decidir correo y soporte:** configurar correo transaccional antes de abrir al público. No existe verificación de email, recuperación de contraseña ni flujo de soporte dentro de la app. Si una persona pierde su clave, hoy no puede restablecerla por sí sola.
5. **Preparar Render:** publicar el código revisado en un repositorio privado; configurar `GEMINI_API_KEY`, `PILAR_REGISTRATION_CODES`, `PILAR_OPEN_REGISTRATION`, `PILAR_LICENSE_CODES`, los modelos y el disco persistente declarados en `render.yaml`. El registro abierto permite crear cuentas sin invitación; como no hay verificación de correo ni recuperación de contraseña, vigila el abuso y habilítalo solo si aceptas ese riesgo. Crear y conservar fuera del repositorio las claves generadas. Mantener una sola instancia mientras usuarios/licencias estén en JSON local.
6. **Prueba de aceptación de producción:** registrar dos cuentas con invitaciones distintas; comprobar sesión después de reiniciar Render, separación de archivos, borrado de cuenta, permisos, HTTPS, límites, IA, transcripción real e imagen real con la cuenta Gemini y cuotas previstas.
7. **Distribución desktop:** el instalador no contiene clave. El comprador introduce su propia clave Gemini en Configuración; queda en su perfil local. Tras confirmar manualmente su pago, emite una licencia Ed25519 ligada a su correo con `npm run license:issue -- desktop correo-del-comprador`. La clave privada del emisor está en `%USERPROFILE%\.pilar-license-issuer`, fuera del proyecto; respáldala cifrada y no la pierdas ni compartas. Nunca distribuyas tu `.env` ni una clave Gemini común.
8. **Confianza desktop:** el instalador generado no está firmado digitalmente. Windows puede mostrar advertencias de SmartScreen; para distribución profesional compra/gestiona un certificado de firma y firma también el ejecutable/instalador.
9. **Resguardo operativo:** definir copias de seguridad cifradas, restauración, respuesta a incidentes, retención/eliminación, costos de almacenamiento y cuota, y procedimiento para rotar secretos.

## Emitir licencias desktop

Inicializar una sola vez; la clave privada se guarda fuera del repositorio en `%USERPROFILE%\.pilar-license-issuer`. Haz una copia cifrada; perderla impide emitir licencias para esta clave pública. No la regeneres después de distribuir PILAR.

```powershell
npm run license:init
npm run license:issue -- desktop correo-del-comprador
```

Confirma el pago en tu cuenta de cobro antes de emitir. El código queda ligado al producto y al correo; se activa localmente y no requiere un servidor de licencias.

El instalador de escritorio actualizado se genera en `dist-installer-sale/PILAR del estudiante Setup 1.0.0.exe`. Todavía no está firmado con un certificado de editor; Windows puede mostrar SmartScreen. No se incluye la clave privada del emisor.

Para registro restringido, genera invitaciones web con `node tools/generate-license-codes.js invite 10` y cárgalas, separadas por coma, en `PILAR_REGISTRATION_CODES`, con `PILAR_OPEN_REGISTRATION=false`. Para registro libre, usa `PILAR_OPEN_REGISTRATION=true`; las invitaciones configuradas se ignoran mientras esa opción esté activa.

## Antes de cobrar

- Confirmar y comunicar el importe configurado de licencia web única: ARS 15.000; no incluye suscripción ni renovación automática.
- Crear/validar cuenta vendedora y credenciales productivas de Mercado Pago.
- Completar facturación, impuestos, privacidad, condiciones, reembolsos y soporte según tu situación.
- Decidir dónde se ofrecerá y entregará el instalador desktop y cómo se remite al comprador el código firmado después de verificar el pago.

No compartas la web ni cobres hasta probar una compra con las credenciales de prueba y luego verificar la configuración productiva.
