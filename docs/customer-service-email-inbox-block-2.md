# Bandeja de correos — bloque 2: interfaz y resultado comprobado

Implementado localmente el 2 de noviembre de 2026. No se aplicó la migración,
desplegaron funciones, publicó frontend o confirmaron vínculos de correos reales.
El bloque 1 se comprobó instalado mediante lectura de su RPC e historial SQL.

## Cambio visible

Requests utiliza una sola bandeja **Correos de Outlook** en lugar del panel de
problemas y los enlaces numerados de advertencia. Incluye filtros y contadores
de correos **Requiere acción**, **Procesando**, **Registrados** y una vista Todos.
Cada fila muestra asunto, remitente y fecha cuando están disponibles, motivo,
folio y acceso a la solicitud. Los contadores representan correos, no requests.

La conexión automática se informa aparte, con un mensaje sobre conexión/pausa,
no sobre el resultado de todos los correos. Los errores técnicos siguen visibles;
sus códigos quedan en detalles desplegables. IMPORT_NEEDS_ATTENTION se atiende
en la fila correspondiente y no mantiene una advertencia global de conexión.

Al seleccionar un correo se consulta su estado guardado actual, no se opera
sobre una fila antigua sin comprobar. Según su estado ofrece:

- Importación fallida con fuente completa: **Reintentar análisis**, respetando
  el próximo intento permitido, o completar datos con el flujo existente.
- Fuente rechazada/incompleta o PDF pendiente: recuperación mediante el
  formulario/PDF ya implementado, conservando las validaciones existentes.
- Correo sin importación o vínculo invalidado: **Vincular a una solicitud
  existente**. El selector busca por folio, propietario o dirección; muestra
  persona, dirección y trabajo, permite abrir la solicitud y exige confirmar
  que se revisó el mismo caso. No elige por coincidencia automáticamente.
- Registrado: **Abrir solicitud CS-…** y etapa humana separada. No ofrece
  repetir el análisis de un registro ya completado.

Un caso nuevo sin importación puede capturarse con New Request y vincularse
después mediante la misma confirmación. Este bloque no importa históricos ni
reinicia el cursor para recuperar un correo omitido por delta.

## Resultado después de reintentar o vincular

La UI conserva el identificador/versiones revisados por la persona y utiliza los
endpoints protegidos existentes. Después consulta el resultado de la bandeja en
BD: solo muestra **Registrado** con una request existente y folio confirmado.
El mensaje de éxito incluye asunto, folio, botón Abrir solicitud y etapa humana,
por ejemplo: «Correo registrado correctamente en CS-2031. Pendiente de revisión
humana». Crear o vincular no aprueba la request.

Se actualizan lista y contadores al finalizar, sin esperar la siguiente consulta
de Outlook. El resultado permanece visible aunque la fila salga del filtro de
pendientes. El refresco automático también actualiza el detalle seleccionado;
no deja un motivo antiguo debajo de una importación ya resuelta.

Ante una respuesta perdida, se consulta el mismo registro sin repetir la
mutación. Si aún no puede verificarse, se muestra «Actualizar estado» y se
bloquea repetir acciones sobre ese correo mientras el resultado es incierto.
Una consulta posterior que confirma el registro elimina la advertencia anterior.
Si falla solamente la recarga de contadores, el resultado verificado conserva
su folio y los contadores quedan desconocidos, nunca un cero supuesto.

Se protegen clics repetidos, respuestas atrasadas, cambio de usuario, filtros y
paginación. Las actualizaciones de la bandeja no sustituyen la versión de un
formulario abierto ni alteran sus cambios pendientes. Se puede abrir una
solicitud vinculada desde la bandeja aunque esté en otra etapa del módulo.

## Complemento backend necesario

Migración nueva **20261102210000_customer_service_email_inbox_metadata.sql**:

- Cabeceras de inventario: asunto, remitente como texto y fecha recibida, más
  marca de actualización. Sin cuerpos, adjuntos, imágenes, bytes o base64.
- Publicación atómica de página/cabeceras, con reserva y validación de identidad,
  tipos, tamaño, fecha, claves y contenido binario. Conserva la firma anterior
  de inventario para compatibilidad con funciones aún no actualizadas.
- La proyección/lectura de bandeja incluye las cabeceras y solo los campos de
  estado/versiones necesarios para reintento y recuperación, sin descargar el
  cuerpo ni el análisis completo al navegador.
- RPC autenticada `read_customer_service_email_inbox_item(p_source_kind,p_id)`
  para comprobar un elemento por su UUID opaco. Respeta conexión configurada y
  rol activo ADMIN/SCHEDULING. No inventa éxito si falta el elemento.

El inventario de Graph pide únicamente id, enlace, asunto, remitente y fecha,
una página acotada en su periodicidad existente. La función reconcile proyecta
estos campos y publica con la RPC nueva. Continúan válidas las páginas antiguas
sin cabeceras; los campos inesperados no se conservan. El delta, worker, análisis
de imágenes/PDF y relaciones de origen de las requests no cambian.

Después del despliegue, los dos correos históricos pueden mostrar temporalmente
asunto/remitente pendientes hasta la siguiente revisión de inventario, cada
15 minutos. La UI lo indica y permite abrir el original. Actualizar estado
consulta la BD; no fuerza Graph, IA ni el worker.

## Validación

- **489 pruebas frontend** pasaron, incluidos 16 casos nuevos de proyección,
  permisos/errores, confirmación, reintento, respuesta perdida, resultado incierto,
  continuación, resolución posterior, contador desconocido, filtros y sesión.
- **158 pruebas Deno** pasaron de conexión, Graph, sync, fuentes, recuperación,
  dispatcher, reconcile, worker e imágenes; tipos de las cuatro funciones.
- **Tres suites SQL remotas** pasaron con la migración dentro de BEGIN/ROLLBACK:
  cabeceras/lectura individual, resolución del bloque 1 y automatización.
- Lint completo y build frontend pasaron. Build conserva el aviso preexistente
  de tamaño de un chunk; no impide compilar.
- Playwright CLI revisó la bandeja en escritorio y móvil de 390 px con datos
  simulados: selección/confirmación humana, cambio de contador, reintento y
  acceso por folio. Casos automatizados de respuesta perdida y no confirmable:
  una sola mutación, ninguna vinculación accidental ni desbordamiento horizontal.

Los fixtures SQL se revierten; sus secuencias de folios pueden avanzar como en
las demás pruebas remotas. No se invocaron Graph/Mistral reales, descargaron
imágenes o resolvieron los mensajes de producción durante la implementación.

Evidencia y fixture local de UI:

- `output/playwright/customer-service-inbox-block2-desktop.png`
- `output/playwright/customer-service-inbox-block2-mobile-success.png`
- `output/playwright/customer-service-inbox-block2-check.js`
- `tmp/customer-service-inbox-block2-check.html` y `.jsx`

## Comandos de instalación

Aplicar primero la migración y después desplegar reconcile y publicar frontend.
No editar las migraciones del bloque 1, ya comprobadas como aplicadas.

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npm run db:test -- customer_service_email_inbox_metadata.test.sql customer_service_email_message_resolution.test.sql
npx supabase functions deploy customer-service-email-reconcile --use-api

Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling'
npm run build
```

`npm run build` genera dist/client y no publica por sí solo. Publicar el frontend
con el procedimiento habitual del proyecto; en desarrollo local, cargar la
versión actualizada. No necesita nuevos secretos, desplegar worker/retry ni
reiniciar cron. Sync debe conservar el despliegue del bloque 1.

Para ensayar sin aplicar:

```powershell
npm run db:test -- --preview-migration 20261102210000_customer_service_email_inbox_metadata.sql customer_service_email_inbox_metadata.test.sql customer_service_email_message_resolution.test.sql customer_service_email_automation.test.sql
```

## Pendiente del bloque 3

Validar la versión publicada con el usuario real, permisos, estados y reintentos.
Comparar los originales Dayspring / CS-2022 e Indigo / CS-2031 y confirmar cada
vínculo desde la bandeja solo después de revisar el mismo caso. Verificar que
salgan de Requiere acción, aparezcan en Registrados con su folio, no nazcan otras
requests y permanezca la revisión humana pendiente. Este bloque no efectuó
esas confirmaciones ni certifica todavía el piloto integral de producción.
