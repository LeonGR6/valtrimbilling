# Importación por correo — bloque 5: procesamiento durable

Entrega local del 22 de octubre de 2026. Migración y función pendientes del
usuario. No se desplegó, habilitó ni programó el worker; no hubo llamadas reales
a Mistral, lectura de Outlook ni carga de binarios reales.
No confundir este bloque con la recuperación histórica del PDF manual.

## Qué conecta

`customer-service-email-worker` procesa **un correo ya registrado y con fuente
AVAILABLE por invocación**, sin depender de tener la app abierta. Reutiliza el
análisis del bloque 4 y el guardado transaccional del bloque 2. Si existe el
mínimo confirmado (propietario e ítem descrito) y todas las fuentes se analizaron,
crea/vincula una sola request NEEDS_REVIEW. Nunca aprueba READY_TO_PROPOSE.

- Reserva transaccional con token y vencimiento; no toma fuentes incompletas,
  rechazadas, casos detenidos para revisión ni reintentos que aún no vencen.
- Un proceso reemplazado no puede guardar avances, análisis ni resultado final.
  Las interfaces backend anteriores no permiten eludir una reserva del worker.
- `worker_checkpoint` retiene resultados y errores sanitizados por fuente. Solo
  se reutilizan resultados ANALYZED de la misma identidad original; los fallidos
  no se presentan como éxito. No guarda binarios/base64 ni modifica originales.
- Al acercarse al límite de ejecución, cede y continúa en otra invocación usando
  los avances confirmados. La continuación normal no consume el límite de fallos.
- Un fallo por fuente detiene esa ejecución, conserva su motivo y no crea una
  request omitiendo el archivo. Si es temporal, programa reintento; si es
  permanente o falta el mínimo, conserva NEEDS_ATTENTION para recuperación humana.
- El guardado se confirma por request vinculada, no por recibir cualquier JSON.
  Una respuesta perdida se recupera mediante la identidad original, sin duplicar
  la request ni sobrescribir correcciones o aprobaciones humanas.

No se garantiza una sola llamada facturada a Mistral si el resultado de una
llamada se pierde antes de confirmar el checkpoint. Sí se evita repetir fuentes
correctamente confirmadas y crear requests duplicadas.

## Archivos y valores operativos

- Migración: `20261022200000_customer_service_email_worker.sql`.
- Procesador/autenticación: `_shared/customerServiceEmailWorker.ts`.
- Tiempo/red y clasificación temporal: `_shared/customerServiceEmailRuntime.ts`.
- Endpoint: `functions/customer-service-email-worker/index.ts`, con configuración
  en `supabase/config.toml`.
- Análisis/adaptador existentes ampliados con callbacks/checkpoints y persistencia
  protegida por token. `serviceClient` admite fetch acotado opcional; los demás
  consumidores conservan su comportamiento cuando no lo proporcionan.

Valores iniciales técnicos: reserva de **3 minutos**, inferencia con presupuesto
de **90 segundos**, ventana separada de finalización hasta 125 segundos y límites
por petición. Cede antes de otra fuente si no queda margen suficiente. La reserva
se renueva al comenzar una fuente y al confirmar avances.

Hasta **3 fallos temporales/interrupciones**, con esperas de **1 y 5 minutos**;
después NEEDS_ATTENTION / WORKER_RETRIES_EXHAUSTED. Se reutiliza `attempt_count`
para invocaciones y un contador separado para fallos: un correo largo puede
necesitar más de tres continuaciones correctas. HTTP 408/425/429/5xx, timeouts,
transporte y conflictos transaccionales recuperables permiten reintento. Una
clave inválida, fuente ilegible o mínimo ausente requiere intervención.

Los tiempos y avances respetan los
[límites de Edge Functions](https://supabase.com/docs/guides/functions/limits),
pero no certifican rendimiento de PDFs grandes/complejos bajo los límites de CPU
y memoria del proyecto. El piloto debe comprobarlo con muestras representativas.
La reserva utiliza
[FOR UPDATE SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html)
para no asignar una fila ocupada a varios consumidores.

## Validación realizada

- **27 pruebas** del worker, autenticación, red y recuperación aprobadas, incluida
  la regresión de configuración de dependencias añadida al corregir el empaquetado.
- **65 pruebas de análisis** y **53 de fuentes/adjuntos** aprobadas.
- **26 regresiones PDF/extracción manual** aprobadas en repetición aislada.
- **396 pruebas frontend** aprobadas; tipos de funciones, lint del código nuevo
  y frontend, y build aprobados. Build conserva el aviso de chunks grandes.
- **10 suites SQL aprobadas** contra el remoto vinculado, ensayando el SQL nuevo
  dentro de cada transacción y terminando en ROLLBACK. No se insertó historial de
  migraciones ni se instaló el cambio permanentemente.
- Historial remoto y dry-run finales: únicamente `20261022200000` pendiente;
  las migraciones aplicadas no se editaron ni se volvieron a instalar.

Incidencia de regresión: una primera ejecución concurrente de las suites mostró
un fallo intermitente en `customerServiceSourcePdf.test.ts`, prueba **concurrent
different PDFs cannot replace the winning object**. Supone que el primer archivo
siempre gana, aunque las operaciones de hash son asíncronas. La repetición
aislada pasó 26/26. No se modificaron ese test ni el módulo PDF manual; no afirmar
que toda ejecución futura de esa prueba es determinista.

Comandos locales desde `apps/backend`:

```powershell
npm run functions:test-email-worker
npm run functions:test-email-analysis
npm run functions:test-email-import
npm run functions:check
npm run functions:check-email-worker
```

### Corrección del empaquetado por función

El primer despliegue comunicado por el usuario falló al resolver `pdf-lib`.
El código dependía del mapa general `functions/deno.json`, utilizado explícitamente
por las pruebas locales, pero no incluido automáticamente en ese empaquetado.
También faltaba resolver `htmlparser2`. Se añadió
`functions/customer-service-email-worker/deno.json` con ambas dependencias y las
mismas versiones fijadas del mapa general. No cambian la lógica, permisos, secretos
ni SQL. El despliegue continúa pendiente hasta que Supabase lo confirme.

Supabase recomienda el
[deno.json específico por función](https://supabase.com/docs/guides/functions/dependencies#using-denojson-recommended).
`functions:check-email-worker` verifica el entrypoint con ese archivo y el lock
existente, sin depender del mapa general de pruebas. Ejecutarlo antes de repetir:

```powershell
npm run functions:deploy -- customer-service-email-worker
```

Esta corrección no requiere otra migración ni habilitar el worker.
Verificación posterior: `functions:check-email-worker` pasó con el lock congelado;
el bundle local se generó correctamente (272 módulos, aproximadamente 1.87 MB) y
pasaron las 27 pruebas del worker. La comprobación local no ejecuta el endpoint
ni sustituye la confirmación del próximo despliegue remoto.

Para repetir el ensayo **solo mientras la migración no esté instalada**:

```powershell
npm run db:test -- --preview-migration 20261022200000_customer_service_email_worker.sql customer_service_email_worker.test.sql customer_service_import_analysis.test.sql customer_service_import_source_storage.test.sql customer_service_imported_request_intake.test.sql customer_service_email_import_registry.test.sql customer_service_request_intake_schema.test.sql customer_service_source_pdf_storage.test.sql customer_service_intake_read.test.sql customer_service_intake_update.test.sql customer_service_request_ready.test.sql
```

El runner combina mecánicamente el SQL y cada suite en un archivo temporal con
BEGIN/ROLLBACK, rechaza controles transaccionales incrustados y elimina el archivo
temporal al terminar. Usa la Management API remota, sin Docker. Realiza DDL/DML
temporal y puede adquirir bloqueos: lock_timeout de 3 segundos y statement_timeout
de 45 segundos en modo preview. No consume correos de la cola real: la suite
del worker reclama exclusivamente las identidades de sus propios fixtures.

## Pendiente del usuario: instalación y despliegue

Desde `apps/backend`, comprobar inventario y SQL pendiente:

```powershell
npx supabase migration list
npm run db:push -- --linked --dry-run --skip-vault
```

Revisar que solo esté pendiente la migración esperada `20261022200000`. Si
aparecen otras, revisarlas antes de aplicar. No editar migraciones aplicadas ni
usar `--include-all` para forzar discrepancias. Después de aprobar el dry-run:

```powershell
npm run db:push -- --linked --skip-vault
npx supabase migration list
npm run db:test -- customer_service_email_worker.test.sql customer_service_import_analysis.test.sql customer_service_import_source_storage.test.sql customer_service_imported_request_intake.test.sql customer_service_email_import_registry.test.sql customer_service_request_intake_schema.test.sql customer_service_source_pdf_storage.test.sql customer_service_intake_read.test.sql customer_service_intake_update.test.sql customer_service_request_ready.test.sql
npm run functions:deploy -- customer-service-email-worker
```

Después de instalar, ejecutar las suites **sin** `--preview-migration`.
No se requiere redesplegar las funciones de lectura de originales ni PDF manual.

## Configuración y prueba controlada

Secretos exclusivos del servidor, mediante Dashboard o un archivo privado fuera
del repositorio; no pegarlos en el chat, frontend ni comandos que queden en el
historial del shell:

- `CUSTOMER_SERVICE_EMAIL_WORKER_SECRET`: secreto aleatorio de alta entropía,
  al menos 32 caracteres; distinto de las claves de Supabase y Mistral.
- `CUSTOMER_SERVICE_EMAIL_WORKER_ENABLED=false` durante despliegue/verificación.
- `API_KEY_MISTRAL_IA`: clave existente del servidor, requerida para habilitar
  procesamiento real. No se imprime ni transmite al navegador.

La función usa `verify_jwt=false` porque la frontera es su secreto de servidor,
no una sesión humana. Un JWT de usuario/anon o llegar al endpoint no autoriza
ejecutar trabajo. Requiere el header `x-valtrim-email-worker-secret` correcto
antes de crear el cliente de servicio. Se admite exclusivamente POST:

- `{}`: siguiente importación elegible.
- `{"importId":"UUID"}`: una importación concreta, recomendado para el piloto.

Sin secreto configurado responde 503; con secreto incorrecto, 401; correctamente
autenticado pero deshabilitado, 409 WORKER_DISABLED, sin reclamar trabajo ni llamar
al proveedor. Body máximo 1024 bytes; no admite intake, rutas, workflow ni límites
de reintento del navegador. Los errores de infraestructura devuelven un código
genérico sin detalles de proveedor, URLs firmadas o secretos.

Habilitar `CUSTOMER_SERVICE_EMAIL_WORKER_ENABLED=true` solo cuando se autorice la
prueba real, con una identidad de muestra preparada mediante el bloque 3. Verificar
fuentes/checkpoints, request NEEDS_REVIEW al recargar, error recuperable y replay
de la misma identidad. Una prueba real con Mistral puede generar cargos.

**No hay cron ni llamadas periódicas activadas.** Próximas invocaciones retoman
PENDING/next_attempt_at o reservas vencidas; guardar una fecha de reintento no
despierta por sí solo la función. La activación periódica debe configurarse como
paso operativo tras el piloto. No se añaden recursiones automáticas del endpoint.

Fuera de esta entrega: conexión Microsoft 365/Graph, panel Correos con problemas,
reintento/recuperación humana desde UI y refresco automático de la bandeja. La
request guardada es compatible con la lectura/edición/revisión existentes; los
problemas técnicos permanecen en BD hasta conectar su panel del bloque siguiente.
