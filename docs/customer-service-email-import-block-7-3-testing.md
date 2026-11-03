# Importación por correo — bloque 7.3: configuración y avance privados

Preparado el 23 de octubre de 2026. Estado actualizado el 27 de octubre: esquema
disponible en remoto y conexión real registrada con identidad verificada y
`BASELINE_ONLY`. Después de habilitar ambos controles, la corrección OData del
bloque 7.4 permitió completar la inicialización real: cursor DELTA, error nulo,
sin reserva y cero importaciones/requests. No hay ejecución periódica activada
por esta entrega. Las comprobaciones de registro siguientes describen su estado
anterior a esa inicialización; ver el estado actual en la guía 7.4.

## Estado operativo del piloto al 27 de octubre de 2026

- Buzón confirmado: `victor@valtriminc.com`; carpeta raíz `Customer Service`, con
  ID Graph obtenido y sus metadatos nuevamente comprobados mediante la app.
- Política confirmada por el usuario: `BASELINE_ONLY`. La primera ronda completa
  establece la línea base sin importar históricos; registrar la conexión no
  inicializa esa ronda ni adelanta el corte de importación.
- `MS365_TENANT_ID`, `MS365_CLIENT_ID` y `MS365_CLIENT_SECRET` guardados y
  verificados en Supabase Secrets el 26 de octubre. La tabla de conexiones no
  almacena esas credenciales; no se copiaron sus valores a esta guía.
- La autenticación app-only y la lectura de la carpeta funcionan sin una sesión
  personal abierta. La consulta inicial del perfil devolvió 403; posteriormente
  el usuario proporcionó `ec1afdfd-199f-4fd4-98e7-069fb4dd909e`, verificado leyendo
  la misma carpeta por UUID y por `victor@valtriminc.com`, con ID/nombre/padre
  coincidentes. No se ampliaron permisos. Consultar el perfil requiere permisos distintos
  de los de lectura de correo; ver [Get user](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0).
- Conexión privada registrada: `779ebb10-fc40-4a30-9a72-639123cbb057`.
  Se usaron tenant verificado, UUID real del usuario, ID Graph de carpeta y
  `BASELINE_ONLY`; no se usó el Object ID de la aplicación.
- El UUID candidato proporcionado después por el usuario se comprobó mediante
  lectura de la carpeta por `/users/{uuid}`: respondió 404. La comparación local
  confirmó que coincide con el Object ID de la aplicación guardado en el archivo
  de credenciales, no con un identificador de usuario verificado. No se registró
  esa identidad ni se modificó la conexión o el buzón.
- La relectura independiente por RPC confirmó `enabled=false`, revisión 1,
  `BASELINE_ONLY`, cero intentos/importaciones y ausencia de cursor, reserva e
  inicialización. Repetir el registro devolvió el mismo ID/revisión y replay=true.
  No se llamó a claim/checkpoint ni se habilitó durante esta configuración.
- Verificación ejecutada: `npm run functions:test-email-connection` (11 PASS) y
  `npm run db:test -- customer_service_email_connection_state.test.sql` (PASS
  contra el proyecto vinculado, fixtures con ROLLBACK). No se consultaron correos,
  crearon requests, subieron adjuntos ni invocó IA.

## Qué entrega

- `private.customer_service_email_connections`: tenant UUID, mailbox object UUID,
  carpeta case-sensitive, activación, política inicial, reserva, cursor completo,
  revisión, intentos, última ronda completa y errores sanitizados. Sin credenciales
  de Microsoft, texto de correo, asignación de coordinador o estados de request.
- Registro idempotente y lectura mediante RPC de sistema. Ningún rol de la app
  puede leer/escribir la tabla; ni siquiera service_role puede actualizarla
  directamente. Los RPC tienen security definer, search_path vacío, ACL explícita
  y rechazan un contexto con identidad humana reenviada.
- Configuración con revisión exacta. Siempre se crea deshabilitada; no se elige
  una política por defecto. Antes de habilitar debe elegirse IMPORT_EXISTING o
  BASELINE_ONLY. La política queda fijada al primer intento. La identidad no se
  puede editar: otro tenant/buzón/carpeta necesita otro registro explícito.
- Reserva de tres minutos, recuperable al vencer mediante otro token. Una
  ejecución vencida, deshabilitada o con revisión atrasada no puede avanzar ni
  liberar la reserva actual. Cada checkpoint NEXT renueva la reserva.
- NEXT conserva la página siguiente; DELTA confirma una ronda completa, libera
  la reserva, fija initialized_at y actualiza last_success_at. Se conserva la URL
  original completa, sin reconstruir tokens ni recortarlos. Se valida HTTPS,
  host Graph comercial, endpoint, mailbox/folder y tipo de token. No se admite
  otra nube de Microsoft, endpoint o recurso por inferencia.
- Antes de avanzar una página de importación, todos los importIds declarados deben
  pertenecer al mismo tenant y UUID canónico de buzón. Un registro con fuente aún
  PENDING/UPLOADING sin problema durable no basta: debe estar AVAILABLE, REJECTED,
  LEGACY o NEEDS_ATTENTION. El futuro conector debe entregar **todos** los mensajes
  no eliminados de la página; SQL no puede detectar una omisión de su respuesta
  Graph. Una página vacía o solo de eliminaciones puede avanzar con lista vacía.
- BASELINE_ONLY durante la primera ronda guarda solo el avance inicial y no acepta
  importIds históricos; después de su primer DELTA aplica la validación ordinaria.
  No se usa `$deltatoken=latest`: ese atajo no está documentado para correo.
- Finalizar con error guarda solo uno de ocho códigos conocidos y un mensaje
  fijo; no acepta errores crudos, secretos o encabezados. Finalizar sin error es
  una pausa, no un éxito. Ambos conservan el cursor y el éxito anterior. Deshabilitar
  también conserva el avance y revoca la reserva. No hay borrado ni reset automático.
- Adaptador `_shared/customerServiceEmailConnection.ts`, sin lectura de env,
  HTTP, temporizadores o dependencias nuevas. Solo usa los RPC y valida el
  estado canónico; no simula éxito si la respuesta falta o no coincide.

RPC nuevos, todos exclusivos de service_role:

1. `register_customer_service_email_connection(tenant, mailbox, folder, initialMode)`.
2. `read_customer_service_email_connection(connectionId)`.
3. `configure_customer_service_email_connection(connectionId, revision, enabled, initialMode)`.
4. `claim_customer_service_email_sync(connectionId)`; null si está deshabilitada u ocupada.
5. `checkpoint_customer_service_email_sync(connectionId, token, revision, kind, url, importIds)`.
6. `finish_customer_service_email_sync(connectionId, token, revision, errorCode)`.

Usar el estado devuelto por cada operación para la siguiente revisión. Una respuesta
perdida exige releer/reconciliar, no repetir un checkpoint con otra revisión a ciegas.
Los errores AUTH_FAILED, FORBIDDEN, FOLDER_NOT_FOUND, GRAPH_THROTTLED,
GRAPH_UNAVAILABLE, CURSOR_EXPIRED, SYNC_INTERRUPTED y SYNC_ERROR son diagnósticos
de conexión, separados de “Correos con problemas”. Este bloque no añade otra UI.

## Validación sin instalar

Resultados verificados: 11 pruebas nuevas del adaptador y 65 pruebas locales en
total junto con reintento/worker/PDF, todas aprobadas. Comprobación de tipos de
todas las funciones aprobada. Diez suites SQL relacionadas pasaron con la migración
pendiente en BEGIN/ROLLBACK. El dry-run mostró únicamente la migración de 7.3,
sin instalarla. No se probó lectura real de Microsoft ni el piloto end-to-end.

Desde `apps/backend`:

```powershell
npm run functions:test-email-connection
npm run functions:check
npm run db:test -- --preview-migration 20261023180000_customer_service_email_connection_state.sql customer_service_email_connection_state.test.sql customer_service_email_import_registry.test.sql customer_service_email_recovery.test.sql customer_service_email_worker.test.sql customer_service_import_source_storage.test.sql customer_service_imported_request_intake.test.sql customer_service_intake_update.test.sql customer_service_request_ready.test.sql customer_service_source_pdf_storage.test.sql customer_service_intake_read.test.sql
```

El runner combina migración pendiente y cada prueba dentro de BEGIN/ROLLBACK;
no instala el DDL ni modifica el historial. Los fixtures aislados se revierten.
Las regresiones de requests pueden avanzar secuencias aunque sus filas se reviertan.
No hay binarios de Storage, lectura de buzón, consumo de IA o cron.

## Instalación del esquema (procedimiento histórico)

El esquema ya está disponible en el remoto y la suite de conexiones pasó el
27 de octubre. Los comandos siguientes conservan el procedimiento original de
instalación; no reaplicar la migración ni usar preview sobre el esquema instalado.

Revisar antes de aplicar, desde `apps/backend`:

```powershell
npx supabase migration list
npm run db:push -- --linked --dry-run --skip-vault
```

Confirmar que aparece únicamente `20261023180000_customer_service_email_connection_state.sql`
como nueva migración. Después de revisar el dry-run:

```powershell
npm run db:push -- --linked --skip-vault
npm run db:test -- customer_service_email_connection_state.test.sql customer_service_email_import_registry.test.sql customer_service_email_recovery.test.sql customer_service_email_worker.test.sql customer_service_import_source_storage.test.sql customer_service_imported_request_intake.test.sql customer_service_intake_update.test.sql customer_service_request_ready.test.sql customer_service_source_pdf_storage.test.sql customer_service_intake_read.test.sql
```

No usar preview después de instalarla. No hay Edge Function nueva que desplegar
en 7.3: el módulo compartido será utilizado por el conector del 7.4. Instalar la
migración no crea ni habilita una conexión. No cambiar ni redesplegar las funciones
anteriores por este bloque.

## Datos y decisiones que siguen pendientes

- Preparar y autorizar el piloto antes de habilitar la
  conexión ya registrada. El conector 7.4 y su migración están desplegados/aplicados;
  el secreto del endpoint ya se guardó y verificó sin activarlo.
  ver [estado y operación](customer-service-email-import-block-7-4-testing.md).
- Reconciliar CURSOR_EXPIRED de forma controlada sin omitir correos. El conector
  ya incluye renovación de tokens y backoff; el restablecimiento administrativo
  de un cursor y la programación periódica siguen pendientes.
- Sincronización periódica, piloto con correo real y visor de adjuntos originales
  permanecen fuera de esta entrega. No hay integración delegada ni OAuth callback.

Referencia del protocolo: [delta por carpeta de Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0).
