# Confirmación de despliegues: imágenes sin retención

Verificado el **28 de octubre de 2026**, con comprobación HTTP a las
**20:16 UTC / 14:16 de Ciudad de México**. Se consultó el proyecto Supabase
enlazado; no se aplicaron migraciones ni se desplegaron funciones en esta revisión.

## Resultado

| Componente | Estado confirmado |
| --- | --- |
| `20261028180000_customer_service_image_source_contract.sql` | Aplicada |
| `20261028200000_customer_service_graph_image_intake.sql` | Aplicada |
| `20261028220000_customer_service_image_worker.sql` | Aplicada |
| `customer-service-email-sync` | ACTIVE, versión 9, verify_jwt false |
| `customer-service-email-worker` | ACTIVE, versión 10, verify_jwt false |
| `customer-service-email-retry` | ACTIVE, versión 6, verify_jwt true |

`supabase migration list` confirmó el historial y `supabase db push --linked
--dry-run --skip-vault` devolvió upToDate true, sin migraciones pendientes.

## Código publicado

Se descargaron las tres funciones mediante `functions download --use-api` a
copias aisladas bajo `apps/backend/supabase/.temp/`; no se sobrescribieron las
fuentes locales. Se compararon fuentes y configuración, normalizando solo CRLF/LF.

- Worker: **20 de 20 archivos coinciden** con el código local.
- Retry: **22 de 22 archivos coinciden** con el código local.
- Sync: **13 de 15 archivos coinciden**, incluidos entrypoint, Graph, recepción,
  recuperación, almacenamiento exclusivo de PDF y contrato V2. Los otros dos son
  auxiliares compartidos que incorporaron después cambios del bloque 3: clases y
  clasificación de errores del worker, más el nuevo normalizador de contadores.
  Ninguno de esos exports modificados se utiliza en el conector desplegado.
  `emailWorkerFetch` y las dos protecciones contra binarios utilizadas por sync
  coinciden exactamente. Estas diferencias no requieren redesplegar sync para
  completar los bloques 2 y 3.

## Base de datos y permisos

Una transacción **BEGIN READ ONLY / ROLLBACK** comparó las huellas de los cuerpos
SQL instalados con los tres cuerpos de la migración local del bloque 3:

- `private.validate_customer_service_import_source_v2`: coincide; no se expone
  directamente a anon, authenticated ni service_role.
- `valtrim.read_customer_service_graph_image_source`: coincide; SECURITY DEFINER,
  ejecución solo para service_role.
- `valtrim.finish_customer_service_email_worker_v2`: coincide; SECURITY DEFINER,
  ejecución solo para service_role.

Se confirmó además el claim V2, ambas columnas del contrato/origen y la
restricción del bucket de importaciones a nuevas cargas `application/pdf`.

## Arranque y protección HTTP

| Comprobación sin credenciales | Resultado |
| --- | --- |
| GET sync | 405, método rechazado |
| GET worker | 405, método rechazado |
| GET retry | 401, exige autenticación |
| OPTIONS retry | 200 con cabecera CORS |

No se enviaron POST, reclamaron importaciones, consultaron correos/adjuntos de
Graph, invocaron Mistral ni alteraron requests o imágenes históricas. Estas
comprobaciones confirman instalación, código y arranque; no certifican el flujo
real completo de un correo V2. El visor del bloque 4 y el piloto integral siguen
pendientes. No se activó sincronización periódica ni se auditó su programación
en esta revisión.
