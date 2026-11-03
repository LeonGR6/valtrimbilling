# Imágenes de correo sin retención — bloque 1: contrato de base de datos

Implementado localmente el **28 de octubre de 2026**. Migración nueva:
`20261028180000_customer_service_image_source_contract.sql`.

**Aplicación remota verificada el 28 de octubre al iniciar el bloque 2.** Se
ensayó originalmente contra el proyecto remoto vinculado mediante
`npm run db:test -- --preview-migration ...`, dentro de BEGIN/ROLLBACK. El ensayo
no instala la migración ni modifica su historial. No se invocaron Graph, Mistral
ni Edge Functions, ni se subieron binarios. No se modificó CS-1876.

## Alcance y activación gradual

Este bloque prepara la BD; **no activa el procesamiento de imágenes sin
retención**. El conector, el worker y el visor desplegados siguen usando el
contrato V1. Los bloques 2, 3 y 4 deben adaptar esos consumidores antes de
considerar operativa la nueva política. No se activa sincronización periódica.

La instalación puede hacerse separadamente porque los contratos son explícitos:

| Contrato | Manifiesto | Archivos publicados | Worker |
| --- | --- | --- | --- |
| V1 | Original histórico, sin reescribir | PDF/imágenes existentes | Firma actual |
| V2 | Todos los adjuntos validados; PDF `STORED`, imagen `GRAPH_ONLY` | Solo PDF | Requiere reclamar mediante el RPC V2 |

Los registros existentes y las altas del conector actual conservan V1. No se
convierten manifiestos anteriores, incluso si quedaron UPLOADING. Esto evita
reinterpretar hashes, rutas, avances o archivos históricos. Su eventual
continuación bajo la política nueva debe resolverse explícitamente en el bloque
del conector; no autoriza subir imágenes nuevas como mecanismo de recuperación.

No se cambian buckets, políticas de Storage, límites, estados del workflow,
aprobación humana, contratos del PDF manual ni mecanismos de recuperación humana.
El bloqueo físico de subidas del runtime se verificará al adaptar el conector;
esta entrega certifica contratos SQL, no transferencia binaria real.

## Contrato para el conector (bloque 2)

1. Registrar el recibo con identidad/metadatos mínimos, como actualmente.
2. Descargar y validar **todo** el cuerpo/conjunto en memoria: formatos, firmas,
   hashes, 10 archivos incluidos inline, 10.000.000 bytes por archivo y
   50.000.000 bytes por correo. SQL valida metadatos y límites, pero no puede
   comprobar la firma de bytes que no recibe.
3. Invocar `prepare_customer_service_graph_source_v2` con `p_connection_id`,
   `p_sync_token`, `p_expected_revision`, `p_import_id`, `p_source_payload` y
   `p_attachments`. Exige reserva/revisión vigentes, conexión inicializada y
   pertenencia exacta de tenant/buzón. La carpeta procede de la conexión privada.
4. Los elementos de entrada siguen siendo los siete campos del manifiesto V1:
   attachmentId, originalFilename, mimeType, sizeBytes, sha256, isInline, contentId.
   Las rutas y la retención son generadas por SQL. Las imágenes V2 no llevan
   objectPath, bucketId ni fileId; mantienen su identidad y SHA-256.
5. Ante validación fallida, el RPC aborta sin fijar fuentes ni publicar archivos.
   El conector debe conservar el problema durable mediante el RPC existente de
   rechazo y mensajes sanitizados. No copiar un error crudo del proveedor.
6. Subir exclusivamente PDF y usar `finalize_customer_service_import_source`.
   Este finalizador conserva V1 y, para V2, exige/publica únicamente los PDF. Un
   conjunto solo de imágenes o sin adjuntos puede finalizar con cero archivos.

AVAILABLE en V2 expresa conjunto completo validado y fijado, con PDF publicados
cuando existan. **No afirma que se conservaron imágenes ni que Graph seguirá
disponible en el futuro.** No aceptar un subconjunto para ocultar una fuente
fallida. No reabrir automáticamente rechazos; las recuperaciones ya autorizadas
conservan su contrato independiente.

## Contrato para análisis/reintentos (bloque 3)

- `claim_customer_service_email_import(uuid)` conserva su firma y solo toma
  fuentes V1 pendientes. Un replay de cualquier request ya vinculada devuelve
  esa misma request inmediatamente. Así el worker instalado no consume V2.
- El futuro worker usará `claim_customer_service_email_import_v2(uuid)`, que
  admite V1/V2 y conserva reservas, intentos, presupuesto de fallos y esperas.
- `read_customer_service_graph_image_source(importId,workerToken)` exige la
  reserva de worker vigente y devuelve la conexión/origen fijados, manifiesto de
  imágenes y retryNotBefore. No devuelve credenciales, tokens de sincronización
  ni URLs de cursor, y no cambia el cursor. El futuro worker debe respetar la
  espera y comprobar los bytes recuperados contra el hash fijado.
- Los RPC existentes de checkpoint/análisis admiten imágenes V2 con fileId nulo,
  validando attachmentId, nombre, hash y tipo contra el manifiesto. PDF conserva
  la referencia real a su archivo. No se permite omitir una imagen del análisis
  completo para alcanzar READY_FOR_INTAKE.
- IMAGE admite texto extraído (string o null), hechos y advertencias; sin texto
  también puede ser ANALYZED. FAILED conserva diagnóstico y no autoriza intake.
  Las páginas/campos PDF no se utilizan como contenedores de imágenes.
- Se rechazan campos de transporte binario, data URIs base64 y firmas conocidas
  de imágenes base64. Cabeceras/cuerpo se validan por tipos y campos permitidos;
  usageInfo solo admite contadores numéricos conocidos. No persistir respuestas
  completas del proveedor. Los límites de estas guardas no sustituyen construir
  los payloads desde campos permitidos en el futuro adaptador ni revisar logs.
- Las guardas de filas/vínculos impiden registrar imágenes como stored_files
  dentro de una importación V2 o asociarle un archivo histórico de imagen.

## Contrato para el visor (bloque 4)

Nuevo RPC autenticado `read_customer_service_import_sources(importId)` para
ADMIN/SCHEDULING activos. Devuelve sourceContractVersion, sourceStatus, webLink y
descriptores con retención, fileId real o nulo, storedFileAvailable y análisis
individual (texto, hechos, modelo, estado y error). No incluye rutas, enlaces
firmados, tokens de worker ni configuración privada de la conexión.

Para GRAPH_ONLY, fileId es nulo y storedFileAvailable es false. Mostrar extracción
y acceso al correo; no generar botones de apertura/descarga de esa imagen.
Los RPC/endpoints actuales de archivos continúan listando únicamente archivos
publicados: PDF V2 y archivos históricos V1. No se modifica el frontend aquí.

## Validación realizada

- Historial remoto/local coincidente hasta `20261027210000`.
- Dry-run: exclusivamente `20261028180000_customer_service_image_source_contract.sql`
  pendiente; no se ejecutó db push sin dry-run.
- **15 suites SQL distintas aprobadas en preview remoto con ROLLBACK**: suite
  nueva de contrato, registro, fuentes, análisis, worker, guardado importado,
  recuperación humana/Graph, conexiones, retry Graph, claves OData, lectura,
  edición, aprobación y PDF manual.
- Casos nuevos: imágenes inline, IDs sensibles a mayúsculas, conjuntos mixtos/sin
  adjuntos, imagen sin texto, validaciones y payloads binarios, PDF faltante,
  idempotencia, fuentes cambiadas, guardas de registros/vínculos, fencing,
  continuaciones, origen Graph, fallos visibles, cobertura de todas las imágenes,
  creación NEEDS_REVIEW y permisos del visor. El fixture del piloto solo se lee
  y compara mediante hashes; no se reanaliza, aprueba ni elimina.

Las filas de storage.objects de las pruebas son **metadatos sintéticos**, no
archivos subidos. La ausencia de subidas reales desde Graph/Mistral debe probarse
en los bloques de runtime posteriores. No se necesita build ni despliegue de
frontend/Edge Functions para esta entrega exclusivamente SQL.

## Comandos de instalación

El bloque 1 ya está aplicado. Los comandos de esta sección se conservan como
referencia histórica; no volver a ejecutar su preview sobre SQL instalado.
Para continuar, usar los [comandos del bloque 2](customer-service-image-no-retention-block-2-testing.md).

Desde PowerShell:

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npx supabase migration list
npx supabase db push --linked --dry-run --skip-vault
```

Confirmar que solo aparece pendiente la migración nueva. Si aparecen otras,
revisarlas antes de aplicar; no usar include-all para ignorar discrepancias.

Ensayo opcional antes de instalar:

```powershell
npm run db:test -- --preview-migration 20261028180000_customer_service_image_source_contract.sql customer_service_image_source_contract.test.sql
```

Aplicación y comprobación posterior:

```powershell
npx supabase db push --linked --skip-vault
npx supabase migration list
npm run db:test -- customer_service_image_source_contract.test.sql customer_service_import_source_storage.test.sql customer_service_import_analysis.test.sql customer_service_email_worker.test.sql customer_service_imported_request_intake.test.sql customer_service_graph_source_recovery.test.sql customer_service_email_recovery.test.sql customer_service_email_import_registry.test.sql customer_service_email_connection_state.test.sql customer_service_graph_retry.test.sql customer_service_graph_odata_folder_keys.test.sql customer_service_intake_read.test.sql customer_service_intake_update.test.sql customer_service_request_ready.test.sql customer_service_source_pdf_storage.test.sql
```

**No hay Edge Functions que desplegar en el bloque 1.** Los nuevos RPC y las
guardas se instalan con la migración. No invocar el contrato V2 desde el runtime
hasta adaptar conector/worker; no generar ni cambiar secretos para este bloque.
