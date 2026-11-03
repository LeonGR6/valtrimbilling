# Importación por correo — bloque 6: consulta, reintento y recuperación

Implementación local del 23 de octubre de 2026. La consulta del panel reutiliza
los RPC existentes. Las acciones nuevas requieren aplicar una migración y
desplegar una función; no se aplicaron ni se activaron automáticamente.

## Alcance y garantías

- Requests mantiene el contador/panel, sin página ni workflow nuevos.
- Reintentar requiere confirmación, sesión real ADMIN/SCHEDULING activa, versión
  exacta y fuente AVAILABLE sin request. Una fuente rechazada no puede omitirse
  ni sustituirse para conseguir un éxito automático.
- `customer-service-email-retry` valida identidad/versión/rol y configuración
  antes de poner trabajo en cola. Invoca el mismo procesador desde el servidor;
  el navegador no recibe secretos ni usa service_role. Respeta la bandera
  CUSTOMER_SERVICE_EMAIL_WORKER_ENABLED y la configuración Mistral existente.
- Los pasos manuales no terminados quedan visibles para continuar, conservando
  checkpoints y backoff. Continuar no reinicia el presupuesto de fallos. Una
  nueva intervención explícita tras un fallo terminal sí permite otro ciclo.
  No hay cron ni recursiones automáticas. Una reserva activa no se roba; la
  siguiente invocación puede recuperar una vencida mediante el protocolo del worker.
- Recuperación reutiliza New Request con contexto de importación, sin fingir
  una request ya guardada. Exige propietario y un ítem, permite fecha/Job/canales
  ausentes y no inventa fechas. El alta manual ordinaria sigue siendo estricta.
- El RPC humano bloquea la misma fila de importación y guarda request/vínculo
  juntos. Un replay devuelve al ganador sin modificar sus campos ni aprobación.
  Auditoría conserva actor y motivo anterior; el original/manifiesto/análisis
  no se sustituyen. El guardado automático sigue exigiendo AVAILABLE.
- El PDF opcional de recuperación usa el bucket y el límite manual de un PDF de
  10 MiB, separado de los adjuntos originales. La extracción existente llena el
  formulario; si falla, se puede capturar manualmente y quitar el PDF si no se
  desea conservar. Guardar campos no certifica una carga de archivos.
- SHA-256, tamaño y nombre del PDF elegido quedan fijados en la misma transacción
  de creación. Frontend, retención y finalizador SQL impiden asociar el PDF de
  un segundo operador a los campos/extracción del ganador. No se admiten rutas
  ni IDs de archivos enviados por el navegador.
- Una carga fallida conserva request/folio y RECOVERY_PDF_PENDING. Reintentar
  reutiliza la identidad y archivo sin overwrite. Después de recargar, el panel
  permite elegir el mismo PDF; si ya está AVAILABLE, finaliza sin volver a subir.
  También se integra con el reintento del visor durante la sesión.

## Validación

Resultados locales: 436 pruebas frontend, 13 pruebas del endpoint de reintento,
27 del worker/runtime y 14 de retención PDF aprobadas; lint, build y tipos de
funciones verificados. Nueve suites SQL relacionadas pasaron con la migración
pendiente dentro de BEGIN/ROLLBACK, sin instalarla. Playwright verificó con datos simulados la confirmación antes
del reintento, actualización del contador, bloqueo del reintento de fuentes
rechazadas y captura manual mínima sin fecha/Job/canal inventados. Las páginas
temporales de esta comprobación se eliminaron; no son una entrada de producción.

La migración pendiente se ensaya con el runner del proyecto: DDL y fixtures van
dentro de BEGIN/ROLLBACK; no se modifica el historial de migraciones. Las
secuencias pueden avanzar al ejecutar fixtures, aunque las filas se reviertan.

Desde `apps/backend`:

```powershell
npm run db:test -- --preview-migration 20261023160000_customer_service_email_recovery.sql customer_service_email_recovery.test.sql customer_service_email_import_registry.test.sql customer_service_email_worker.test.sql customer_service_import_source_storage.test.sql customer_service_imported_request_intake.test.sql customer_service_intake_update.test.sql customer_service_request_ready.test.sql customer_service_source_pdf_storage.test.sql customer_service_intake_read.test.sql
npm run functions:check-email-retry
npm run functions:test-email-retry
npm run functions:test-email-worker
npm run functions:test-source-pdf
```

Las pruebas del endpoint usan autenticación/worker simulados; no consumen IA.
La prueba SQL de PDF usa metadatos sintéticos de Storage, no un binario real.
No equivale a una prueba real de inferencia ni de transferencia de PDF.

## Pendiente del usuario: instalar

Desde `apps/backend`, revisar que solo aparezca la migración esperada:

```powershell
npx supabase migration list
npm run db:push -- --linked --dry-run --skip-vault
```

Después de revisar el dry-run:

```powershell
npm run db:push -- --linked --skip-vault
npm run db:test -- customer_service_email_recovery.test.sql customer_service_email_import_registry.test.sql customer_service_email_worker.test.sql customer_service_import_source_storage.test.sql customer_service_imported_request_intake.test.sql customer_service_intake_update.test.sql customer_service_request_ready.test.sql customer_service_source_pdf_storage.test.sql customer_service_intake_read.test.sql
npm run functions:deploy -- customer-service-email-retry
```

No usar `--preview-migration` después de aplicar la migración. Mantener
verify_jwt=true en la función nueva. No requiere un secreto nuevo. Para probar
el reintento con IA se necesita CUSTOMER_SERVICE_EMAIL_WORKER_ENABLED=true y la
clave Mistral existente; la recuperación manual no depende de esa bandera.

El endpoint PDF también debe desplegarse: ahora verifica la identidad fijada
antes de escribir en Storage. No usar recuperación PDF hasta desplegar ambas
funciones y aplicar la migración:

```powershell
npm run functions:deploy -- customer-service-source-pdf
```

No es necesario redesplegar el worker ni la extracción PDF por estos cambios.
Usar el frontend actualizado. No subir credenciales del servidor al frontend.

## Prueba humana tras instalar

1. Con una importación NEEDS_ATTENTION cuya fuente sea AVAILABLE, confirmar
   Reintentar análisis. Verificar request única NEEDS_REVIEW o motivo actualizado.
   Si hay avances/espera, usar Continuar análisis según la fecha indicada.
2. Con fuente REJECTED, verificar reintento deshabilitado; abrir recuperación.
   Capturar propietario e ítem sin fecha/Job/canal y guardar. Recargar: misma
   request, vínculos persistentes, fecha ausente y ninguna aprobación automática.
3. Repetir con PDF real válido. Comparar datos extraídos y abrir el PDF retenido.
   Esta prueba consume IA al extraer. No modifica el original rechazado.
4. Interrumpir una carga después de guardar: conservar folio y problema. Reabrir
   desde el panel, elegir el mismo archivo y terminar; nunca crear otra request.
5. Probar dos operadores: el ganador conserva su request; el formulario obsoleto
   no sobrescribe cambios humanos. Verificar roles denegados/inactivos.

Graph, visor de adjuntos originales y ejecución periódica no se activan aquí.
