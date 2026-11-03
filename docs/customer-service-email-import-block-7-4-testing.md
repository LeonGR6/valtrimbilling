# Importación de correo — punto 4 / bloque 7.4: conector Graph

Implementado en código el 27 de octubre de 2026. Migración aplicada y endpoint
`customer-service-email-sync` ACTIVE v7, verificados remotamente. La conexión
`779ebb10-fc40-4a30-9a72-639123cbb057` ya está registrada con el UUID del usuario
`ec1afdfd-199f-4fd4-98e7-069fb4dd909e`, carpeta verificada y `BASELINE_ONLY`.
Ambos controles están habilitados por el usuario. La inicialización real terminó
con ROUND_COMPLETE, cursor DELTA conservado, error limpio y reserva liberada;
la línea base no creó importaciones/requests. El piloto posterior dejó un correo
rechazado por tamaño; los bloques 1 y 2 corrigieron y recuperaron ese mismo
registro. El piloto del 28 de octubre lo procesó y creó CS-1876 en NEEDS_REVIEW,
con sus siete imágenes. No hay ejecución periódica activada por
esta entrega. `CUSTOMER_SERVICE_EMAIL_SYNC_SECRET`
ya se generó, guardó y verificó en Supabase Secrets: 64 caracteres aleatorios,
sin almacenar su valor en el repositorio. El interruptor global está habilitado y
los tres secretos MS365 estaban presentes. No requiere iniciar sesión personalmente en
Microsoft para ejecutar sus pruebas simuladas.

## Piloto de procesamiento — bloque 3, 28 de octubre

El usuario autorizó el bloque 3 y la rotación del secreto del worker. El nuevo
CUSTOMER_SERVICE_EMAIL_WORKER_SECRET está en Supabase; su huella se verificó sin
imprimir el valor. La copia de operador es
`apps/backend/supabase/.temp/customer-service-email-worker-secret.dpapi`, cifrada
con Windows DPAPI para el mismo usuario y excluida de Git. No se cambió el secreto
de sincronización ni la clave Mistral. No se creó un scheduler.

El primer intento registró ANALYSIS_FAILED en el cuerpo, sin request y sin analizar
las imágenes. El error previo no conservaba diagnóstico suficiente; no se atribuye
una causa específica sin evidencia. Se añadieron códigos seguros y estado HTTP
cuando exista; los campos del esquema reportados nunca incluyen claves desconocidas,
contenido del correo, credenciales ni mensajes crudos del proveedor. El worker
actualizado se desplegó ACTIVE v9. No se requirió migración nueva.

El reintento explícito del piloto usa el script de operador
`apps/backend/scripts/Test-CustomerServiceEmailPilot.ps1` (PowerShell 7.2+). Exige
CLI con acceso administrador al proyecto vinculado y el secreto DPAPI del mismo
usuario; nunca recibe ni imprime una clave. `-RetryAttention` usa bloqueo, versión
exacta, estado/causa técnica conocidos, ausencia de request/reserva y presupuesto
de fallos vigente. Audita como SYSTEM y conserva archivos, checkpoints e intentos.
No es el reintento de la UI ni suplanta la sesión de una persona.

```powershell
# Consulta/procesa este importId. Si ya está procesado, confirma su misma request.
./scripts/Test-CustomerServiceEmailPilot.ps1 -ImportId '70288f7b-6169-4963-af47-3f1df7cc967a'
```

Resultado real: **PROCESSED, requestId 876, folio CS-1876, NEEDS_REVIEW**. Se
analizaron ocho fuentes (un cuerpo y siete imágenes). La segunda llamada devolvió
PROCESSED, idempotentReplay=true y requestId 876. SELECT independientes confirmaron
una request vinculada, siete referencias originales, attempt_count=2 sin aumento
por el replay, worker_failure_count=0 y reserva/error limpios. No hubo aprobación:
reviewed_at sigue nulo. Hay un contacto principal con nombre y un ítem no vacío;
Job y work category quedan pendientes para revisión. Las fotos/logos no crearon
ítems extra; sus análisis y advertencias siguen como referencia.

Pruebas: 102 backend (27 worker/runtime, 67 análisis/fuentes y 8 OCR), 52 frontend
de persistencia/bandeja/visor, cinco suites SQL con ROLLBACK, tipos y lint de los
archivos modificados. Las suites SQL de aprobación nunca alteran la request real.

```powershell
npm run functions:test-email-worker
npm run functions:test-email-analysis
npm run functions:check-email-worker
npm run db:test -- customer_service_email_worker.test.sql customer_service_import_analysis.test.sql customer_service_imported_request_intake.test.sql customer_service_intake_read.test.sql customer_service_request_ready.test.sql
```

**Pendiente visual:** la app local abrió el login; falta una sesión real
ADMIN/SCHEDULING para comprobar CS-1876, su correo y los adjuntos en el visor.
Se pidió al usuario entrar. No dar por realizada esa comprobación ni su aprobación
humana. Este correo no tiene PDF: no certifica OCR de PDF real. El cron queda
pendiente de la validación completa del piloto.

## Recuperación controlada — bloque 2

Implementado, instalado, desplegado y probado con el mismo correo el 27 de octubre.
La migración nueva y aplicada es
`20261027210000_customer_service_graph_source_recovery.sql`. Añade el RPC
`prepare_customer_service_graph_source_recovery`, exclusivo de service_role sin
JWT humano; no cambia las migraciones anteriores ni la recuperación PDF/manual.

El endpoint existente admite, de forma explícita y con su mismo secreto de
servidor, este segundo tipo de petición:

```json
{
  "connectionId": "779ebb10-fc40-4a30-9a72-639123cbb057",
  "sourceRecovery": {
    "importId": "70288f7b-6169-4963-af47-3f1df7cc967a",
    "expectedUpdatedAt": "versión updated_at exacta en ISO 8601"
  }
}
```

La versión se obtiene mediante una lectura autorizada, sin convertirla a Date de
JavaScript que perdería microsegundos. No enviar el secreto en código del
navegador ni en archivos/comandos del repositorio. La petición normal con solo
connectionId sigue funcionando como antes.

1. Exigir secreto, activación global, credenciales y conexión privada habilitada
   e inicializada. Reclamar su reserva; respetar cooldown y cursor vencido.
2. Leer el registro existente y comprobar tenant/buzón. Una fuente AVAILABLE o
   request vinculada se devuelve como replay, sin otra descarga o edición.
3. Para un rechazo de tamaño sin manifiesto, descargar desde el mismo mensaje
   y carpeta, enumerar todos los adjuntos y validar el conjunto completo. No usar
   una página delta, mover el mensaje ni reiniciar cursor/línea base.
4. El RPC comprueba reserva/revisión, versión exacta, estado, identidad y ausencia
   de archivos fijados/publicados, extracción o worker. Reabre y prepara la fuente
   en una sola transacción; un payload inválido revierte toda la operación.
5. Guardar una auditoría SYSTEM con el error anterior y corrección conocida. Subir
   archivos inmutables y finalizar con el contrato existente. Un fallo de subida
   conserva el manifiesto y se retoma con los mismos bytes/hashes, sin otra auditoría.
6. Una respuesta SOURCE_RECOVERED significa fuente disponible, **no request creada
   ni aprobada**. El worker/IA corresponde al bloque 3 y no se invoca aquí.

Archivos nuevos: `_shared/customerServiceEmailSourceRecovery.ts`, su adaptador
`customerServiceEmailSourceRecoveryStorage.ts` y pruebas. El handler de sync
rechaza parámetros extra y no acepta contenido, credenciales o URLs del cliente.
Las respuestas son sanitizadas: SOURCE_RECOVERED, RECOVERY_REJECTED,
RECOVERY_CONFLICT o UNCONFIRMED; no son nuevos estados del workflow de requests.

En la primera ejecución real se detectó otro caso: File de Graph con MIME
application/octet-stream. El SDK multipart usaba ese tipo del File, ignorando
contentType, y Storage rechazaba el primer archivo. Se reprodujo con seis pruebas
del SDK real/transporte simulado para PDF/JPEG/PNG con MIME genérico o vacío. La
corrección del adaptador crea un File con el MIME ya validado del manifiesto,
preservando todos sus bytes y el original. No se amplían los tipos del bucket.

**Verificación final:** 126 pruebas locales PASS (67 conector/recuperación y 59
adjuntos/almacenamiento), tipos del endpoint y lint. Cuatro suites SQL PASS tanto
en preview/ROLLBACK como con la migración instalada:

```powershell
npm run functions:test-email-sync
npm run functions:test-email-import
npm run functions:check-email-sync
npm run db:test -- customer_service_graph_source_recovery.test.sql customer_service_email_recovery.test.sql customer_service_import_source_storage.test.sql customer_service_graph_retry.test.sql
```

Tras revisar historial y dry-run, se aplicó solo la migración indicada y se
desplegó el conector ACTIVE v7. La reanudación real respondió HTTP 200,
SOURCE_RECOVERED, retained=1, mismo importId. SELECT posteriores confirmaron:
AVAILABLE/PENDING, siete objetos privados y siete relaciones publicadas,
8.901.705 bytes, una importación y una auditoría que conserva el ATTACHMENT_SIZE
original. El cursor no cambió y la reserva quedó liberada. request_id y extracción
nulos, cero intentos del worker. **El bloque 3 queda pendiente por indicación
del usuario.** No se llamó a Mistral ni se activó cron.

## Corrección de tamaños Graph — bloque 1

El piloto con el correo real produjo ATTACHMENT_SIZE: el campo `size` de los
siete adjuntos era distinto de su descarga cruda. Se corrigió únicamente el
adaptador Graph, sin relajar el contrato compartido de archivos ni cambiar BD.
Microsoft documenta `/$value` como [descarga de contenido crudo del adjunto](https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0).
No se presupone que el tamaño informado de metadatos sea idéntico a esos bytes.

- Metadatos: conservar identidad, tipo, extensión, MIME, cantidad incluyendo
  inline y tamaño entero seguro no negativo. No rechazar por límites calculados
  con `size` de Graph ni reenviarlo como `declaredSize` del archivo crudo.
- Descarga: limitar el stream a 10.000.000 bytes por archivo y al presupuesto
  restante de 50.000.000 bytes por correo. Un exceso cancela la lectura y no
  devuelve un conjunto parcial. El encabezado Accept depende del tipo de
  respuesta, no del tamaño del presupuesto restante.
- Integridad: exigir respuesta completa HTTP 200, sin Content-Range, y contenido
  no vacío; comparar Content-Length si corresponde a bytes sin Content-Encoding.
  Si fetch descomprime el cuerpo, no compararlo con una longitud comprimida.
  Sin ese encabezado se mantiene la lectura completa limitada. Una interrupción
  sigue siendo GRAPH_UNAVAILABLE y no entrega archivos parciales.
- Antes de almacenar: seguir usando el validador compartido de límites reales,
  formato, firma y SHA-256 para el conjunto completo. No escribir el cuerpo ni
  subir el primer archivo si el segundo es inválido.

Verificación del 27 de octubre de 2026: **108 pruebas PASS** (55 de conector y 53
de adjuntos/almacenamiento), tipos del endpoint y lint de los tres archivos
TypeScript modificados. Las regresiones cubren el patrón real de siete imágenes,
tamaños informados menores/mayores/cero, metadatos que superan 10/50 MB con archivos
reales válidos, límites reales exactos y excesos, descargas vacías/interrumpidas o
parciales, Content-Length, firma inválida, correo sin adjuntos y PDF más PNG inline.

```powershell
npm run functions:test-email-sync
npm run functions:test-email-import
npm run functions:check-email-sync
npm run functions:deploy -- customer-service-email-sync --project-ref lovqyhwwsettprenfrrq
```

El despliegue se verificó ACTIVE v5 y GET 405 METHOD_NOT_ALLOWED, sin invocar la
sincronización. Una consulta SELECT del registro y lecturas Graph del mismo
correo mediante el cliente corregido validaron **7 imágenes, 4 inline, 8.901.705
bytes reales**, con formato/firma/hash aceptados. Las siete tenían diferencias
entre metadatos y bytes. Todo se procesó en memoria, sin guardar archivos ni
llamar a Mistral. El registro `70288f7b-6169-4963-af47-3f1df7cc967a` permanece
REJECTED/NEEDS_ATTENTION al cerrar ese bloque, con request_id nulo. No se requirió migración para el bloque 1.

Después se implementó el bloque 2 descrito arriba; sigue pendiente el bloque
3, worker y validación de request NEEDS_REVIEW/revisión humana. Volver a invocar
el conector no reabre automáticamente una fuente rechazada.

## Corrección de enlaces OData y reintento real

El 27 de octubre Microsoft devolvió enlaces `mailFolders('ID')` durante la línea
base, produciendo SYNC_ERROR antes de guardar el cursor. Se corrigieron tres
comprobaciones: cursor backend, recurso previo a HTTP y validador SQL. Se admite
también la forma original `/mailFolders/ID`. La URL/token se conservan sin
reconstruirlos; solo se interpreta el segmento para comprobar las identidades.
Se mantienen buzón exacto, carpeta sensible a mayúsculas, host HTTPS, ausencia de
credenciales/fragmentos y correspondencia/unicidad de skiptoken/deltatoken.

La migración **nueva y aplicada** es
`20261027200000_customer_service_graph_odata_folder_keys.sql`; las anteriores no
se editaron. Historial/dry-run mostraron solo esta pendiente antes de aplicarla.
Pasaron 58 pruebas locales (15 conexiones y 43 conector), comprobación de tipos
de las funciones y tres suites SQL con ROLLBACK tanto antes como después de aplicar:

```powershell
npm run functions:test-email-connection
npm run functions:test-email-sync
npm run functions:check-email-sync
npm run db:test -- customer_service_graph_odata_folder_keys.test.sql customer_service_email_connection_state.test.sql customer_service_graph_retry.test.sql
```

El despliegue corregido es ACTIVE v4. La llamada real posterior devolvió HTTP 200
con ROUND_COMPLETE y cero mensajes retenidos/repetidos/eliminados/históricos.
La relectura independiente de BD confirmó initialized_at y last_success_at
presentes, cursor DELTA con ruta OData, last_error_code nulo, sin reserva y cero
importaciones/requests del buzón. No se descargaron cuerpos/adjuntos ni se llamó
al worker o IA. La inicialización ya está resuelta; el piloto con una entrada
posterior y el procesamiento por el worker siguen pendientes.

## Funcionamiento

1. Un proceso autorizado del servidor invoca `customer-service-email-sync` con
   un `connectionId` explícito. Se requieren secreto del endpoint, interruptor
   global y conexión privada habilitada. Nunca recibe configuración o claves
   desde el navegador.
2. La aplicación obtiene un token con `MS365_TENANT_ID`, `MS365_CLIENT_ID` y
   `MS365_CLIENT_SECRET`. Lee exclusivamente la carpeta configurada, una página
   delta por invocación. Solicita `$top=1` para reducir trabajo por ejecución,
   pero procesa todos los mensajes que devuelva Microsoft, sin asumir ese tamaño.
3. Durante la primera ronda BASELINE_ONLY conserva el avance y los IDs históricos. No
   descarga cuerpos/adjuntos ni registra importaciones históricas. El primer
   deltaLink establece el corte; registrar la conexión no inicializa esa ronda.
   Los IDs históricos se guardan en una tabla privada junto con ese avance.
   Aunque se pide `changeType=created`, Graph puede devolver cambios de leído/no
   leído: esos IDs siguen excluidos. Una salida observada elimina únicamente
   esa pertenencia histórica, permitiendo una entrada posterior a la carpeta.
4. Después de la línea base obtiene cuerpo completo y todos los adjuntos,
   incluyendo inline aunque hasAttachments sea falso. Enumera la colección con
   paginación y descarga los archivos desde rutas Graph construidas con IDs
   codificados, sin seguir URLs externas ni redirecciones.
5. Conserva el registro técnico mínimo, valida el conjunto completo y reutiliza
   el almacenamiento privado existente. Archivos inválidos producen un problema
   recuperable, sin guardar cuerpo, request ni archivos parcialmente válidos.
   Un fallo de infraestructura durante una carga ya validada conserva el estado
   técnico/objetos inmutables conforme al contrato del bloque 3.
6. Solo confirma el cursor cuando todos los mensajes de la página, salvo los
   históricos excluidos, están
   retenidos o tienen un problema durable. Repetir un mensaje reutiliza identidad
   y datos originales; no modifica una request, correcciones humanas ni aprobación.
   Una página parcial se repite desde el cursor anterior. Un checkpoint cuya
   respuesta se pierde se reconcilia leyendo en la siguiente invocación.
7. Las fuentes AVAILABLE quedan PENDING en la cola del worker existente. **El
   conector no ejecuta IA ni crea la request:** hay que invocar aparte
   `customer-service-email-worker`. Ese worker crea NEEDS_REVIEW y mantiene la
   aprobación humana. La programación periódica de ambos sigue fuera del bloque.

PDF/JPG/JPEG/PNG, 10 MB decimales por archivo, 10 adjuntos y 50 MB por correo.
No se descartan adjuntos inline, elementos Outlook o referencias para aceptar
solo el subconjunto válido: los dos últimos tipos requieren recuperación manual.
El `contentId` se conserva si está disponible en los metadatos; no se inventa.
No se filtra por fecha de envío: un mensaje antiguo que entre después de la
línea base sigue siendo una entrada. Las eliminaciones de Graph no borran requests.

Los transportes tienen presupuesto de tiempo, cancelación y límite JSON de
16 MiB por respuesta. Una fuente demasiado grande/ilegible queda para recuperación
manual, sin truncarla; una respuesta delta inválida no avanza la sincronización.
Un fallo temporal conserva el cursor y un código fijo. Retry-After se guarda
en `retry_not_before` y SQL impide reclamar antes de esa hora. Un cursor vencido
queda bloqueado para reconciliación administrativa posterior, sin descartarlo ni
importar históricos automáticamente. La recuperación administrativa de ese
cursor no forma parte de esta entrega.

## Archivos principales

- `_shared/customerServiceMicrosoftGraph.ts`: autenticación, lectura, paginación
  y descarga limitadas a Graph/buzón/carpeta; errores sanitizados.
- `_shared/customerServiceEmailSync.ts`: coordinación de página completa y
  frontera HTTP del servidor.
- `_shared/customerServiceEmailSyncStorage.ts`: adaptador a registro/fuentes
  existentes. No introduce otra tabla de requests ni otro procesador IA.
- `customer-service-email-sync/index.ts` y su `deno.json`: endpoint desplegable.
- `20261027190000_customer_service_graph_retry.sql`: columna de espera, reclamo
  con cooldown, tabla privada de IDs históricos y RPC de consulta/checkpoint
  atómicos de la línea base. No crea conexión/cron.

Los paths anteriores son relativos a `apps/backend/supabase/functions`, salvo
la migración que está en `apps/backend/supabase/migrations`.

## Pruebas

Desde `apps/backend`, sin Docker:

```powershell
npm run functions:test-email-sync
npm run functions:test-email-connection
npm run functions:check-email-sync
npm run db:test -- customer_service_graph_retry.test.sql customer_service_email_connection_state.test.sql customer_service_email_worker.test.sql customer_service_import_source_storage.test.sql
```

Las pruebas HTTP usan respuestas simuladas; no usan las credenciales reales,
leen el buzón ni llaman Mistral. Cubren línea base, email/PDF/inline, páginas
parciales, replay, respeto de datos originales, adjuntos rechazados, URLs maliciosas,
throttling, renovación de token, timeouts, cursor vencido y respuestas perdidas.
Las pruebas SQL usan UUIDs aislados y BEGIN/ROLLBACK en el remoto vinculado.
Además comprueban que una fuente completa retenida puede ser reclamada por el
worker real, sin IA, archivos de Storage o creación de requests de negocio.
Las regresiones del worker/fuentes pueden crear fixtures transitorios y avanzar
secuencias; sus filas se revierten.

Resultados verificados el 27 de octubre: **134 pruebas locales PASS** (41 del
conector, 13 de conexiones, 27 de worker/runtime y 53 de adjuntos/almacenamiento),
**cuatro suites SQL remotas PASS** con la migración en preview/ROLLBACK, comprobación
de tipos de todas las funciones y del endpoint con su configuración de despliegue
aprobadas. Lint de los módulos nuevos aprobado. El historial y dry-run mostraron
únicamente `20261027190000_customer_service_graph_retry.sql` pendiente en esa
prueba previa a instalación. Después se verificó el historial remoto aplicado,
tabla/columna/RPC presentes y endpoint ACTIVE v1 con respuesta GET 405 esperada.
No se repitió el piloto ni la batería SQL posterior al despliegue durante esa
verificación de solo lectura.

## Migración y despliegue (ya realizados)

Estos pasos conservan el procedimiento original como referencia. La migración
`20261027190000` ya figura aplicada y la función ACTIVE v1: no repetirlos como
un pendiente actual ni usar preview sobre el esquema instalado.

Revisar primero:

```powershell
npx supabase migration list
npm run db:push -- --linked --dry-run --skip-vault
```

Comprobar que las migraciones pendientes sean las esperadas. Después de revisarlas:

```powershell
npm run db:push -- --linked --skip-vault
npm run db:test -- customer_service_graph_retry.test.sql customer_service_email_connection_state.test.sql customer_service_email_worker.test.sql customer_service_import_source_storage.test.sql
npm run functions:deploy -- customer-service-email-sync
```

No usar preview después de instalar. No editar migraciones ya aplicadas.
El despliegue usa el `deno.json` propio y el lock existente; no se añadieron
dependencias. No requiere redesplegar el worker del bloque 5.

Mantener `CUSTOMER_SERVICE_EMAIL_SYNC_ENABLED` ausente o `false` hasta preparar
el piloto. Antes de cualquier ejecución real hacen falta:

- `CUSTOMER_SERVICE_EMAIL_SYNC_SECRET` ya está configurado y verificado en
  Supabase Secrets con 64 caracteres. Es distinto del secreto del worker;
  su valor se entregó al usuario por solicitud expresa, sin guardarlo en Git
  ni exponerlo al frontend. No hace falta volver a generarlo para el piloto.
- Los tres secretos MS365 ya configurados y vigentes.
- La conexión ya registrada es `779ebb10-fc40-4a30-9a72-639123cbb057`, con
  `BASELINE_ONLY` y deshabilitada. Se verificó la carpeta por UUID y por dirección,
  sin ampliar permisos ni usar el Object ID de la aplicación.
- Autorizar y habilitar explícitamente la conexión y el interruptor global al
  iniciar el piloto. No activar cron durante esta configuración.

## Invocación del piloto cuando esté autorizado y configurado

Enviar POST al endpoint con header `x-valtrim-email-sync-secret` y JSON
`{"connectionId":"UUID_DE_LA_CONEXION_REGISTRADA"}`. No utilizar ese ejemplo
literal como un ID real. La respuesta no contiene claves, cuerpos ni cursores.

- `PAGE_RETAINED`: página confirmada; invocar otra vez para continuar la ronda.
- `ROUND_COMPLETE`: se confirmó un deltaLink. Durante el primer BASELINE_ONLY
  no significa que se hayan importado correos históricos.
- `IDLE`: conexión deshabilitada, ocupada o esperando Retry-After.
- `FAILED`: error sanitizado, sin avanzar una página incompleta. Respetar el
  header Retry-After cuando esté presente.
- `NEEDS_RECONCILIATION`: cursor vencido; detener reintentos automáticos.
- `UNCONFIRMED`: releer/reinvocar para reconciliar el último resultado.
- `LEASE_LOST`: otra ejecución o un cambio de configuración revocó la reserva.

Después, invocar el worker existente usando cada `importId` retenido o su cola
general. Repetir el worker cuando devuelva PENDING, respetando sus propias esperas,
hasta completar la extracción o mostrar el problema recuperable. Ver
[operación del worker](customer-service-email-import-block-5-testing.md).

Faltan la prueba con el buzón real, revisión visual en la app, visor de originales
y activación periódica. El piloto deberá confirmar NEEDS_REVIEW, errores y
recuperación, ausencia de duplicados y aprobación humana READY_TO_PROPOSE.

## Referencias de Microsoft

- [Autenticación sin usuario](https://learn.microsoft.com/en-us/graph/auth-v2-service).
- [Delta de mensajes por carpeta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0).
- [IDs inmutables](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).
- [Adjuntos de mensajes](https://learn.microsoft.com/en-us/graph/api/message-list-attachments?view=graph-rest-1.0).
- [Descarga de adjuntos](https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0).
- [hasAttachments e inline](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0).
- [Throttling y Retry-After](https://learn.microsoft.com/en-us/graph/throttling).
- [Expiración y reinicio de delta](https://learn.microsoft.com/en-us/graph/delta-query-overview).
