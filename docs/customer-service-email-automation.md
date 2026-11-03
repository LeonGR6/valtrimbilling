# Importación automática de Customer Service

Implementación local del 30 de octubre de 2026. La migración instala el
programador **pausado**. Este cambio no se despliega ni activa automáticamente.

## Comportamiento

- Un único job de Supabase Cron consulta el estado cada minuto y solicita una
  página delta a Microsoft Graph cuando la conexión está disponible.
- El worker se invoca únicamente si existe una fuente AVAILABLE elegible de la
  conexión configurada: pendiente, continuación, reintento vencido o reserva
  interrumpida. No depende de que haya llegado otro correo. Se omiten esperas,
  reservas vigentes, fuentes rechazadas y requests ya asociadas.
- Una reserva técnica abarca la espera de pg_net y la ejecución HTTP. Evita
  lanzar dos workers automáticos mientras la llamada anterior sigue pendiente.
  Las reservas/idempotencia por importación siguen protegiendo la misma request,
  incluso frente a un reintento manual concurrente.
- La comprobación independiente de carpeta se realiza cada 15 minutos; si hay
  más de 100 mensajes, continúa por páginas en minutos siguientes. Solo lee
  IDs y enlaces originales, sin cuerpos, adjuntos ni IA. Excluye registros ya
  importados y mensajes de la línea base. Los no registrados se señalan tras
  una tolerancia de dos minutos. Se muestran hasta 20 enlaces originales.
  Detectar un faltante **no** lo reimporta ni reinicia delta. Un correo antiguo
  que permanecía sin importar puede aparecer como aviso y requiere revisión.
- Continúan vigentes los límites y validaciones de adjuntos, las imágenes solo
  en memoria, los PDF privados y la aprobación humana. No se crean propuestas
  ni se envían correos. Una request nueva queda NEEDS_REVIEW.
- Requests muestra estado, errores, pausa y correos no registrados. Consulta
  un resumen pequeño por minuto mientras la pestaña está visible y al regresar
  a ella. Solo recarga la colección si cambia su revisión. Las ediciones abiertas
  conservan la versión que estaba revisando la persona.

Consultar cada minuto no garantiza terminar el registro en 60 segundos: hay
una página delta por ejecución y el worker puede esperar al minuto siguiente,
continuar o reintentar. Procesar adjuntos/IA agrega su propio tiempo. El alcance
no incluye webhooks, alertas externas ni importación retrospectiva automática.

## Seguridad y recuperación

Las dos claves existentes se copian a Supabase Vault para que el dispatcher
pueda firmar llamadas. Deben coincidir exactamente con los secretos de las Edge
Functions. No se escriben sus valores en migraciones, cron.command ni pg_net.

En este proyecto las tablas de pg_net pertenecen a supabase_admin y su permiso
PUBLIC no se puede retirar con el rol postgres. Por eso el transporte lleva una
firma HMAC SHA-256 ligada al endpoint, destino, vencimiento de tres minutos y
nonce de un solo uso. La Edge Function verifica la firma y consume la reserva
con un RPC exclusivo del servidor antes de ejecutar el handler existente. No
se admite usar esa firma para recuperación manual ni cambiar su destino.

Los fallos HTTP, timeouts y estados fallidos dentro de HTTP 200 son visibles.
El dispatcher conserva solo tres resúmenes sanitizados; elimina sus propias
respuestas HTTP al recogerlas y retiene siete días del historial de su job.
No elimina auditoría de negocio, fuentes ni requests. Los reintentos existentes
conservan tres fallos como máximo y Retry-After. Un cursor delta vencido detiene
esa consulta para recuperación controlada; nunca se reinicia silenciosamente.

Pausar rechaza llamadas en cola que aún no consumieron su firma. Una ejecución
ya iniciada puede terminar. Reanudar conserva cursor, identidad y checkpoints.
No se impone un cupo de 10 correos diarios: era una estimación de volumen.
No se agregó un presupuesto de gasto ni una regla nueva de agotamiento de
continuaciones sin avance; siguen siendo controles operativos pendientes.

## Desplegar sin activar

Ejecutar en PowerShell. Detenerse si cualquier comando devuelve error.

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npx supabase migration list
npx supabase db push --dry-run
```

La única migración nueva de este cambio es
`20261030180000_customer_service_email_automation.sql`. Revisar el listado y
el dry-run antes de aplicar; no modificar ninguna migración aplicada.

```powershell
npx supabase db push
npm run db:test -- customer_service_email_automation.test.sql
npx supabase functions deploy customer-service-email-sync --use-api
npx supabase functions deploy customer-service-email-worker --use-api
npx supabase functions deploy customer-service-email-reconcile --use-api
```

`customer-service-email-retry` no necesita un despliegue por este cambio: su
contrato manual no cambió. La función nueva utiliza las credenciales Microsoft
y el secreto/flag de sync ya existentes. Verificar que
CUSTOMER_SERVICE_EMAIL_SYNC_ENABLED y CUSTOMER_SERVICE_EMAIL_WORKER_ENABLED
siguen en true y que están configuradas las credenciales de Microsoft/Mistral.

Compilar y publicar también el frontend por el procedimiento habitual del
proyecto. `npm run build` en apps/frontend solo genera los archivos de build;
no los publica por sí mismo.

Si migration list o db push muestran 28P01, necesitan la **contraseña de la base
Postgres** del proyecto, distinta del access token y de las claves del correo.
Puede cargarse sin escribirla en el historial de PowerShell:

```powershell
$csDbPassword = Read-Host 'Contraseña Postgres de Supabase' -AsSecureString
$csDbCredential = New-Object System.Management.Automation.PSCredential('postgres', $csDbPassword)
$env:SUPABASE_DB_PASSWORD = $csDbCredential.GetNetworkCredential().Password
# Repetir migration list y db push --dry-run; aplicar solo después de revisarlos.
# Al terminar los comandos que la necesitan:
Remove-Item Env:SUPABASE_DB_PASSWORD
$csDbCredential = $null
$csDbPassword = $null
```

No se necesita Docker ni una base local.

## Configurar Vault y activar

1. En el proyecto lovqyhwwsettprenfrrq, abrir **Vault** en el Dashboard de
   Supabase. Crear estos nombres exactos, con los valores que ya tienen las
   Edge Functions; no generar claves distintas ni pegarlas en el chat:

   | Nombre en Vault | Valor que debe copiarse |
   | --- | --- |
   | customer_service_email_sync_secret | CUSTOMER_SERVICE_EMAIL_SYNC_SECRET |
   | customer_service_email_worker_secret | CUSTOMER_SERVICE_EMAIL_WORKER_SECRET |

2. Con los tres despliegues confirmados y el frontend publicado, activar:

   ```powershell
   npx supabase db query --linked --file scripts/enable-customer-service-email-automation.sql
   npx supabase db query --linked --file scripts/inspect-customer-service-email-automation.sql
   ```

   El script fija exclusivamente la conexión probada
   779ebb10-fc40-4a30-9a72-639123cbb057 y el proyecto indicado. No cambia buzón,
   carpeta, política inicial ni cursor. Repetir la activación no crea otro job.

3. Mover **un correo nuevo de prueba** a Customer Service; no borrar registros
   anteriores. Esperar sincronización y análisis. Confirmar una sola request
   NEEDS_REVIEW, campos/fuentes y ausencia de archivos nuevos de imágenes.
   Repetir la inspección; ningún worker debe lanzarse cuando no hay pendientes.
   Las requests CS-2022 y CS-2023 ya procesadas deben conservar su identidad.

4. Para pausar y luego reanudar, sin borrar avance:

   ```powershell
   npx supabase db query --linked --file scripts/pause-customer-service-email-automation.sql
   # Reanudar:
   npx supabase db query --linked --file scripts/enable-customer-service-email-automation.sql
   ```

## Validación del cambio

**Primera prueba automática real del 2 de noviembre:** el cron detectó el correo,
retuvo sus fuentes y ejecutó el worker sin llamadas manuales. El cuerpo y dos
JPEG inline quedaron ANALYZED, sin guardar imágenes. No se creó request: el
extractor puso el nombre explícito del propietario en sourceLabel y dejó name
vacío, por lo que la importación quedó NEEDS_ATTENTION. Hace falta corregir ese
resultado y retomar la misma importación para cerrar la prueba integral. Ver
[evidencia y diagnóstico](customer-service-email-automatic-test-2026-11-02.md).

**Verificación posterior al despliegue:** se confirmó aplicada la migración
20261030180000 y las funciones ACTIVE sync v10, worker v16 y reconcile v1. Por
instrucción del usuario se crearon los dos nombres requeridos en Vault con los
valores existentes: sync desde su archivo local y worker desde la copia DPAPI
protegida por Windows. Sus SHA-256 coincidieron con los metadatos de los secretos
desplegados antes de la copia y una lectura independiente confirmó la coincidencia
después. No se cambiaron secretos de Edge Functions, crearon archivos de claves
en texto plano ni mostraron valores. El programador continúa sin configurar,
con enabled=false y cronActive=false; falta su activación y la prueba real.

Resultado del 30 de octubre: **159 pruebas Deno**, **470 pruebas frontend** y
**cuatro suites SQL remotas** aprobadas (automatización, conexión, worker de
imágenes e intake Graph V2), además de tipos de los tres endpoints, lint y build.
La suite de automatización se repitió después de los casos finales de enlace
original y respuesta perdida; también pasó. Build conserva el aviso existente
de un chunk principal mayor de 500 kB.

La comparación por Management API confirmó 79 versiones remotas y únicamente
20261030180000 pendiente localmente. migration list mediante conexión Postgres
devolvió 28P01 por autenticación; no se ejecutó db push ni se aplicó la migración.
La validación SQL usó el runner remoto de Management API con rollback. La lectura
posterior confirmó que cron.job y la configuración de automatización siguen sin
instalarse. No se desplegaron funciones ni se activó una consulta periódica.

La suite remota del programador ensaya la migración pendiente dentro de
BEGIN/ROLLBACK: no altera el historial de migraciones, no confirma ninguna
llamada de pg_net y no usa correos, adjuntos ni IA reales.

```powershell
npm run db:test -- --preview-migration 20261030180000_customer_service_email_automation.sql customer_service_email_automation.test.sql
npm run functions:test-email-automation
npm run functions:test-email-sync
npm run functions:test-email-worker
npm run functions:test-email-retry
npm run functions:check-email-sync
npm run functions:check-email-worker
npm run functions:check-email-reconcile
```

Se comprobaron la cola vacía, firmas/replay/destino/vencimiento, reintentos
vencidos/futuros, reservas expiradas/vigentes, continuaciones, fuentes rechazadas,
HTTP 200 fallido, paginación independiente, línea base, protección del cursor,
permisos, pausa y ausencia de nuevas requests/objetos binarios por el scheduler.
Las regresiones existentes cubren texto, imágenes con/sin texto, PDF+imagen,
fallos y duplicados. Frontend: suite de pruebas, lint y build.

Queda por verificar después del despliegue la ejecución real cron → pg_net →
Edge Functions → Graph/Mistral. La prueba con rollback no demuestra conectividad
de esa cadena ni que Vault coincida con los valores desplegados.

Referencias de plataforma: [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[Microsoft Graph: listar mensajes y conservar nextLink](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0).
