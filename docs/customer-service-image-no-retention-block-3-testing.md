# Imágenes sin retención — bloque 3: worker y reintentos

Preparado localmente el **28 de octubre de 2026**. En la implementación original
no se aplicó/desplegó esta entrega. Una revisión posterior del mismo día confirmó
los tres bloques SQL aplicados y sync ACTIVE v9, worker ACTIVE v10 y retry ACTIVE
v6. Se contrastaron fuentes descargadas, definiciones SQL y arranque HTTP; no
quedan migraciones pendientes. No se invocaron Graph/Mistral reales ni se procesó
correo durante la revisión. Ver
[evidencia de despliegues](customer-service-image-deployment-verification-2026-10-28.md).

## Resultado

- `claim_customer_service_email_import_v2` mantiene reservas exclusivas para
  fuentes V1/V2 y replay de requests existentes.
- El worker comprueba todo el manifiesto y sus límites antes de inferir. Para
  imágenes V2 usa el RPC protegido por su reserva y la conexión/mensaje originales;
  descarga secuencialmente desde Graph, valida firma/tamaño/SHA-256 y analiza en
  memoria. No enumera otro buzón ni sustituye el original si cambió o desapareció.
- El texto pertinente de una imagen se guarda en su análisis junto con hechos
  estructurados. Una foto/logotipo sin texto puede terminar con text null y sin
  inventar trabajos o identidad. El proveedor devuelve un sobre estricto
  `{text, structuredData}`; los contratos de texto y PDF siguen siendo los mismos.
- Solo se conservan campos conocidos, contadores numéricos de uso y diagnósticos
  seguros. Se rechazan ecos de binarios/data URI en texto o hechos. El transporte
  de imagen a visión se construye en memoria; no se copia al reporte, checkpoint,
  tablas o logs, ni se usa la API de archivos del proveedor para imágenes.
- Los análisis válidos se reutilizan por identidad y hash. Una imagen completada
  no necesita Graph/credenciales en el reintento. Los PDF y archivos V1 mantienen
  su descarga privada de Storage; no se crean archivos ni vínculos para imágenes
  nuevas. Los siete archivos históricos de CS-1876 quedan intactos.
- El worker y el endpoint humano de reintento comparten el mismo flujo. Una
  espera de conexión o continuación por presupuesto conserva avances sin sumar
  fallos. Graph 429/503 conserva Retry-After; el próximo intento nunca se adelanta
  al backoff actual de 1/5 minutos. Se mantiene el máximo de tres fallos.
- El finalizador conserva la transacción/idempotencia actual y crea una sola
  request NEEDS_REVIEW. No aprueba ni activa sincronización periódica.

## Migración y funciones

`20261028220000_customer_service_image_worker.sql` reemplaza el validador V2 y la
lectura del origen Graph, y añade `finish_customer_service_email_worker_v2`.
No cambia migraciones aplicadas, tablas de negocio, cursores ni archivos.
IMPORT_EXISTING puede recuperar imágenes antes de terminar su primera ronda;
BASELINE_ONLY mantiene su corte. Una conexión deshabilitada devuelve un problema
de origen separado del error 55000 de reserva perdida.

Redesplegar **customer-service-email-worker** y **customer-service-email-retry**
después de aplicar la migración. Usan los secretos existentes `MS365_TENANT_ID`,
`MS365_CLIENT_ID`, `MS365_CLIENT_SECRET`, `API_KEY_MISTRAL_IA` y la configuración
actual del worker; no se requieren secretos nuevos ni cambios de JWT.
El conector del bloque 2 debe estar desplegado para crear nuevas fuentes V2.
El visor y la presentación de extracción sin archivo corresponden al bloque 4.

## Validación

- 69 pruebas de análisis/proveedor y regresión V1.
- 43 pruebas de worker/runtime/recuperación Graph/análisis V2.
- 86 pruebas del conector, incluidos límites de flujo, adjuntos inline, duplicados
  y cargas exclusivas de PDF.
- 59 regresiones de validación/almacenamiento histórico y 13 pruebas del reintento
  humano: **270 pruebas TypeScript en total**, todas aprobadas.
- Tipos de ambas funciones con lock congelado.
- Formato y lint de los quince archivos TypeScript de este bloque.
- SQL remoto mediante `npm run db:test -- --preview-migration ...`, con BEGIN /
  ROLLBACK y sin alterar el historial de migraciones: suites de worker V2,
  contrato V2, worker histórico, reintento humano e ingreso Graph V2.
- Historial de migraciones y dry-run: únicamente `20261028220000` pendiente.

Los casos nuevos cubren imagen con/sin texto, correo sin archivos, PDF+imagen,
hash cambiado, archivo ausente, fallos transitorios/permanentes, espera durable,
continuaciones, duplicados, campos binarios del proveedor y cero subidas/registros
de imagen. SQL verifica NEEDS_REVIEW sin revisor, límites de fallos, reservas,
rechazo de base64 y conservación del piloto. Esto valida código y contratos;
el flujo real con Graph/Mistral y el visor quedan sin certificar en esta entrega.

## Aplicación manual desde PowerShell

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npx supabase migration list
npx supabase db push --linked --dry-run --skip-vault
```

Confirmar que el dry-run muestra solo la migración nueva esperada; después:

```powershell
npx supabase db push --linked --skip-vault
npm run db:test -- customer_service_image_worker.test.sql customer_service_image_source_contract.test.sql customer_service_email_worker.test.sql customer_service_email_recovery.test.sql customer_service_graph_image_intake.test.sql
npx supabase functions deploy customer-service-email-worker --use-api
npx supabase functions deploy customer-service-email-retry --use-api
```

No se necesita Docker. Estos comandos no invocan el worker, activan cron ni
borran imágenes históricas. Para repetir el preview antes de aplicar:

```powershell
npm run db:test -- --preview-migration 20261028220000_customer_service_image_worker.sql customer_service_image_worker.test.sql
```
