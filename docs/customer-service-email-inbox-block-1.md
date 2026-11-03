# Bandeja de correos — bloque 1: estado y resolución en backend

Preparado localmente el 2 de noviembre de 2026. Migración y despliegue a cargo
del usuario. No se confirmaron vínculos sobre los dos correos reales.

Actualización posterior: se comprobó la migración del bloque 1 aplicada. El
[bloque 2](customer-service-email-inbox-block-2.md) incorpora la interfaz,
cabeceras legibles y lectura individual mediante una migración nueva; conserva
los permisos, auditoría y validaciones descritos aquí.

## Decisión aprobada

Una advertencia se resuelve cuando existe una request registrada o cuando una
persona autorizada confirma que el correo corresponde a una request existente.
No basta cerrar un mensaje visual. Cada resultado debe permitir consultar la
request y distinguir importación completada de revisión/aprobación humana.
Un asunto, una dirección o una conversación parecidos no confirman duplicados.

La comparación previa encontró coincidencias de propietarios, dirección y
trabajo en Dayspring / CS-2022 e Indigo / CS-2031. Se presentan como casos para
confirmación humana; esta migración no los vincula automáticamente.

## Implementación

Migración nueva `20261102200000_customer_service_email_message_resolution.sql`:

- Agrega UUID opaco a los mensajes detectados por inventario. El navegador no
  necesita IDs Graph, tenant, buzón, cursor o reservas.
- Tabla privada `customer_service_email_message_resolutions`: identidad de
  conexión/mensaje, request existente, folio, persona y fecha de confirmación,
  versión y actualización. Sin cuerpos, adjuntos, bytes, base64 o imágenes.
- La confirmación valida actor ADMIN/SCHEDULING activo, buzón/conexión, request
  existente, versión y ausencia de importación previa o sincronización activa.
  Un mensaje ya importado conserva su flujo actual de consulta/reintento y no
  puede recibir otro vínculo por esta API.
- Una confirmación repetida al mismo destino devuelve el resultado existente,
  sin otra auditoría ni request. Un destino diferente o una versión atrasada
  no sobrescribe el vínculo. Solo puede volver a confirmarse otro destino si
  el anterior dejó de existir, leyendo primero la versión actual.
- Auditoría `SERVICE_EMAIL_EXISTING_REQUEST_CONFIRMED`: actor, correo opaco,
  resultado anterior y folio/request confirmados. No incluye texto de correo,
  credenciales, imágenes ni identificadores del proveedor.
- El vínculo sobrevive a la salida del correo de la carpeta y a la recreación
  de su fila de inventario. Si se elimina legítimamente la request, su FK pasa
  a null, cambia la versión y el correo vuelve a requerir acción cuando figura
  en el inventario. Se conservan el folio anterior y la auditoría. No cambia
  ninguna protección existente contra la eliminación de requests importadas.
- Un bloqueo por mensaje evita confirmar y registrar una nueva importación a
  la vez. Un trigger impide que incluso un registrador antiguo cree otra
  importación para una identidad con vínculo vigente.

La proyección privada de la bandeja reúne importaciones de la conexión
configurada y correos encontrados sin importación. Expone tres estados:

| Estado | Condición |
|---|---|
| PROCESSING | Importación pendiente/en proceso, sin request terminada. |
| REQUIRES_ACTION | Importación con problema, correo sin registro o vínculo invalidado. |
| REGISTERED | Importación PROCESSED con request realmente vinculada, o confirmación humana vigente. |

NEEDS_REVIEW de una request registrada no cuenta como error de importación.
Una recuperación PDF pendiente con request creada sigue requiriendo acción.
La lectura incluye folio y etapa humana por separado; nunca aprueba la request.

## RPC para el bloque 2

Solo ADMIN/SCHEDULING activos, con JWT del usuario:

```text
list_customer_service_email_inbox(p_state?, p_limit=50, p_offset=0)
count_customer_service_email_inbox()
confirm_customer_service_email_request(p_message_id, p_request_id, p_expected_version)
```

`p_message_id` es el UUID opaco de una fila FOLDER_MESSAGE; no es su ID Graph.
La versión inicial es 0. La lista devuelve `resolutionVersion`, estado, motivo,
folio y etapa humana. La confirmación devuelve REGISTERED, request, folio,
versión e idempotentReplay. La UI debe refrescar la bandeja/contadores después
de confirmar; ante una respuesta perdida debe consultar/repetir la misma
confirmación, sin generar otra request.

La lista admite filtro de los tres estados y páginas de 1 a 100 elementos.
Sus contadores representan correos, no requests: varios correos confirmados
pueden mostrar el mismo folio sin crear solicitudes adicionales.
No devuelve cuerpos, extracciones o archivos. El inventario actual contiene
solo IDs/enlaces: los correos FOLDER_MESSAGE aún devuelven asunto/remitente null;
la presentación y mejora de esos metadatos corresponden al bloque de interfaz.
No se inventan nombres a partir de URLs ni de coincidencias sugeridas.

La API existente `read_customer_service_email_automation_status` conserva sus
campos y agrega `inboxCounts`, incluyendo una revisión ligera para actualizar
la bandeja. `missingCount` y `missingMessages` excluyen vínculos vigentes, sin
esperar otra revisión de Outlook. El script de diagnóstico usa la misma
proyección; requiere haber aplicado esta migración.

## Sincronización

El adaptador obtiene los IDs vinculados mediante
`read_customer_service_email_resolved_matches`, exclusiva de service_role y
protegida por la reserva/revisión de la conexión. La coincidencia es exacta y
solo excluye destinos que existen. Una identidad diferente continúa por el
flujo normal, aunque tenga el mismo asunto o dirección.

Un mensaje confirmado se omite antes de descargar cuerpo/adjuntos o registrar
otra importación, incluso si Graph comunica su salida y reentrada. Se informa
`resolvedSkipped` cuando corresponde. Si la consulta falla, no se avanza el
cursor ni se interpreta como ausencia de vínculos. La línea base, los límites,
reintentos, worker condicionado y política PDF/imágenes permanecen vigentes.
Una delta vacía no agrega otra consulta de vínculos ni invoca un worker vacío.

## Validación

Pasaron **157 pruebas Deno** de conexión, Graph, sincronización, fuentes,
recuperación, automatización, worker e imágenes. Pasaron tipos de sync,
reconcile, worker y retry, y lint de los cuatro archivos TypeScript modificados.

Pasaron **cinco suites SQL remotas**: resolución, automatización, recuperación,
conexiones y Graph retry. Se ensayó la migración dentro de BEGIN/ROLLBACK mediante
el runner del proyecto, sin aplicarla ni modificar el historial de migraciones.
Los fixtures se revierten; las secuencias de folios pueden avanzar en estas
pruebas de creación, como en las demás suites remotas.

Se verificaron permisos e inactividad, concurrencia mediante reserva/versión,
idempotencia, aislamiento por buzón, conservación de auditoría, estados de
recuperación PDF, persistencia tras inventario, borrado de una request manual,
reapertura, reconfirmación, bloqueo de registradores antiguos y ausencia de
nuevos registros/objetos/binarios de imágenes. Proveedores simulados; no se
invocaron Graph/Mistral reales durante la implementación.

Para repetir el ensayo sin aplicar:

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npm run db:test -- --preview-migration 20261102200000_customer_service_email_message_resolution.sql customer_service_email_message_resolution.test.sql customer_service_email_automation.test.sql customer_service_email_recovery.test.sql customer_service_email_connection_state.test.sql customer_service_graph_retry.test.sql
```

## Instalación por el usuario

La migración debe aplicarse antes de desplegar sync. El conector actualizado
requiere la RPC nueva; no hay fallback que ignore una comprobación fallida.
El código anterior sigue funcionando mientras no se confirmen vínculos nuevos;
no usar la nueva confirmación hasta desplegar sync.

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npm run db:test -- customer_service_email_message_resolution.test.sql
npx supabase functions deploy customer-service-email-sync --use-api
```

Revisar listado/dry-run antes de aplicar; no editar migraciones ya instaladas.
No requiere nuevos secretos ni desplegar worker, retry o reconcile. No activa,
pausa o reinicia cron. La bandeja visual, botones, mensajes y confirmación de
los correos reales corresponden al bloque 2; el piloto integral al bloque 3.
