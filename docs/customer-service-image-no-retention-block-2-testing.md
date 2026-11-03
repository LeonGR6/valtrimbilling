# Imágenes sin retención — bloque 2: conector Graph

Preparado localmente el **28 de octubre de 2026**. Requiere el contrato V2 del
bloque 1 (`20261028180000`), cuya aplicación remota se verificó en esta entrega.

Nueva migración: `20261028200000_customer_service_graph_image_intake.sql`.
Función que debe redesplegarse: **customer-service-email-sync**.
Actualización al iniciar el bloque 3: la migración de este bloque se comprobó
aplicada en remoto. No se verificó el despliegue de la función en esa entrega.
El estado descrito a continuación corresponde al cierre original del bloque 2.
La migración y el despliegue quedan pendientes del usuario. No se procesaron
correos reales ni se invocó IA, worker, subidas binarias o sincronización
periódica. Las siete imágenes históricas de CS-1876 permanecen intactas.

## Resultado de este bloque

- Las fuentes nuevas pasan al contrato V2: cuerpo completo permitido y manifiesto
  de todos los adjuntos validados, con imágenes GRAPH_ONLY y PDF STORED.
- Graph enumera también adjuntos inline, aunque hasAttachments sea false.
  Se conservan límites, firma, SHA-256, IDs sensibles a mayúsculas, rutas/URLs
  acotadas, paginación, Retry-After y rechazo completo ante un archivo inválido.
- Se descargan/validan los bytes en memoria antes de fijar fuentes o subir un PDF.
  Solo los PDF llegan a Storage. SQL recibe metadatos/hashes, nunca File, Blob,
  buffers o base64 de imágenes. El manifiesto devuelto se comprueba completo antes
  de subir el primer PDF; una política/ruta inesperada detiene la preparación.
- Cabeceras/remitente/destinatarios se construyen con campos/tipos permitidos;
  no se copian objetos completos de Microsoft. El recibo previo contiene solo
  metadatos técnicos seguros. Los errores no incluyen respuestas crudas del SDK.
- Los PDF conservan MIME validado, bytes, rutas deterministas, no-upsert y
  recuperación por tamaño/hash ante una respuesta de carga perdida.
- Un correo sin adjuntos o solo con imágenes finaliza sin llamadas a Storage.
  No se crean requests ni aprobaciones en este conector.

**Las fuentes V2 quedan AVAILABLE/PENDING para el bloque 3.** El worker instalado
solo reclama fuentes V1; instalar/desplegar este bloque no completa el análisis
de imágenes ni el alta automática de nuevas requests V2. El visor se adapta en
el bloque 4. No activar cron como parte de esta entrega.

## Restricción de Storage y compatibilidad

La migración cambia únicamente allowed_mime_types del bucket privado de
importaciones a application/pdf. Conserva el tamaño de 10.000.000 bytes, la
privacidad, los objetos existentes y el bucket separado del PDF manual.
Es una restricción de **nuevas cargas**, según el contrato de
[Supabase Storage](https://supabase.com/docs/guides/storage/buckets/creating-buckets#restricting-uploads).
No contiene borrados ni reescrituras del manifiesto o de los siete archivos del piloto.

- Fuentes históricas AVAILABLE/LEGACY o con request: replay sin nuevas lecturas
  de Graph, subidas ni cambios humanos.
- V1 ya fijado con imágenes y sin publicar: el delta registra un problema visible
  y conserva su manifiesto/archivos. La operación explícita de recuperación lo
  rechaza sin convertirlo. Usar la recuperación humana existente; nunca subir
  imágenes como fallback de compatibilidad.
- V1 fijado solo con PDF: se mantiene su contrato de preparación/finalización,
  sin conversión. La recuperación explícita histórica conserva sus requisitos
  de auditoría y versión previos.
- V2 interrumpido: recuperar los archivos del manifiesto fijado, sin adoptar
  cuerpo/lista nuevos de Microsoft. Una diferencia de hash/nombre no sustituye la
  fuente. Un RPC V2 ausente falla sin recurrir al almacenamiento V1 de imágenes.

## Recuperación explícita y migración

El endpoint conserva su comando sourceRecovery con connectionId, importId y
expectedUpdatedAt; sigue exigiendo secreto y activación del servidor. No acepta
tenant, buzón, carpeta, fuente, archivos o credenciales del llamador.

Nuevo RPC `prepare_customer_service_graph_source_recovery_v2`:

1. Exige conexión inicializada, reserva/revisión vigentes, pertenencia al mismo
   tenant/buzón y ausencia de reserva de worker/request que pueda sobrescribirse.
2. Reabre únicamente los rechazos de tamaño previamente autorizados, sin fuente
   fijada/archivos/extracción. Fija V2 junto con la reapertura en una transacción.
3. También permite reanudar una fuente V2 UPLOADING de esa conexión, con versión
   exacta. No convierte manifiestos V1, incluso si ya hay objetos en preparación.
4. Audita SYSTEM, error previo, conexión y versión del comando con corrección
   GRAPH_IMAGE_NO_RETENTION. No copia diagnósticos binarios históricos a la nueva
   auditoría. El mismo replay auditado puede usar su versión original, siempre
   comparando íntegramente el cuerpo/manifiesto inmutables; no duplica la auditoría.
5. Conserva cursor, línea base, intentos de análisis, presupuesto de fallos y
   aprobación humana. Un fallo de validación anterior al SQL no modifica una
   fuente pendiente a partir de un comando humano con versión obsoleta.

La migración también corrige el prepare V2 del bloque 1 para permitir la primera
ronda IMPORT_EXISTING antes del primer DELTA. BASELINE_ONLY sigue omitiendo
históricos y no fija fuentes antes de inicializarse. No cambia modos ni cursores.

## HTML con datos binarios

Las imágenes inline entregadas como fileAttachment se validan normalmente.
Si el HTML contiene una imagen codificada como data URI/base64 dentro del propio
cuerpo, se rechaza la fuente completa con un motivo sanitizado y enlace al
original: no se guarda ese HTML, no se recorta para aparentar éxito y no se sube
un subconjunto de PDF. Esta entrega no inventa adjuntos virtuales ni descarga
imágenes/enlaces externos. La recuperación humana existente queda disponible.

## Validación realizada

- Historial remoto: bloque 1 aplicado; dry-run: solo `20261028200000` pendiente.
- **86 pruebas locales del conector** y **59 regresiones de validación/archivos**
  aprobadas; lockfiles congelados. Tipos del endpoint y lint de los doce archivos
  TypeScript implicados aprobados.
- **13 suites SQL distintas aprobadas** en el remoto vinculado mediante preview
  de la migración y BEGIN/ROLLBACK: contrato nuevo de Graph, contrato V2 del bloque
  1, fuentes, recuperación Graph, retry Graph, claves OData, conexiones, worker,
  análisis, guardado importado, recuperación humana, aprobación y PDF manual.
- Casos: cuerpos/cabeceras seguros, inline, siete imágenes con cero solicitudes
  a Storage, correo sin adjuntos, PDF+imagen, archivo inválido después de un PDF
  válido, respuesta de manifiesto inválida, cambios de identidad, RPC ausente,
  PDF con respuesta perdida, finalización perdida, duplicados, carrera con
  recuperación humana, histórico publicado/pendiente, origen Graph distinto,
  versiones/reservas y auditoría. Se inspeccionan los JSON de RPC y el FormData
  real generado por el SDK en transportes simulados; los uploads contienen solo PDF.

Los fixtures SQL de Storage son metadatos y no transfieren binarios reales.
Las lecturas comparan hashes del importId del piloto, sus vínculos y metadatos de
objetos sin editarlos. Esto no certifica inferencia real, revisión visual,
aprobación de CS-1876 ni el futuro worker V2.

## Comandos

Desde PowerShell, antes de instalar:

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npx supabase migration list
npx supabase db push --linked --dry-run --skip-vault
```

Debe aparecer aplicada `20261028180000` y únicamente pendiente `20261028200000`.
Si aparece otra diferencia, revisar el inventario antes de continuar.

Ensayo opcional sin instalar:

```powershell
npm run db:test -- --preview-migration 20261028200000_customer_service_graph_image_intake.sql customer_service_graph_image_intake.test.sql customer_service_image_source_contract.test.sql customer_service_import_source_storage.test.sql
```

Instalación y comprobación:

```powershell
npx supabase db push --linked --skip-vault
npx supabase migration list
npm run db:test -- customer_service_graph_image_intake.test.sql customer_service_image_source_contract.test.sql customer_service_import_source_storage.test.sql customer_service_graph_source_recovery.test.sql customer_service_graph_retry.test.sql customer_service_graph_odata_folder_keys.test.sql customer_service_email_connection_state.test.sql customer_service_email_worker.test.sql customer_service_import_analysis.test.sql customer_service_imported_request_intake.test.sql customer_service_email_recovery.test.sql customer_service_request_ready.test.sql customer_service_source_pdf_storage.test.sql
npm run functions:test-email-sync
npm run functions:check-email-sync
npx supabase functions deploy customer-service-email-sync --use-api
```

Desplegar después de aplicar SQL. Se conserva verify_jwt=false de la configuración
existente y la autorización por secreto propio; no cambiar ni generar secretos.
No hay que desplegar worker, email-retry, visor de archivos ni función PDF para
este bloque. No ejecutar una sincronización real ni habilitar ejecución periódica
como parte de estos comandos de instalación.
