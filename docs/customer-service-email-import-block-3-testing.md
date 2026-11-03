# Importación por correo — bloque 3: archivos privados y validación

Preparado localmente el 22 de octubre de 2026, sin aplicar SQL ni desplegar en
esa implementación. Posteriormente el usuario aplicó la migración y desplegó
la función. Se verificaron inventario remoto, función ACTIVE v1 con JWT, rechazo
sin autenticación, preflight y las ocho suites SQL indicadas abajo, todas PASS
con ROLLBACK. No se probó transferencia binaria real ni inferencia real.

El bloque 4 prepara después el análisis compuesto localmente; conector, worker y
panel de problemas siguen pendientes. Esta guía no corresponde al antiguo bloque
3 de aprobación. Las instrucciones de aplicación se conservan como referencia,
no como indicación de volver a aplicar una migración ya instalada.

## Entrega

- Migración nueva: `20261022160000_customer_service_import_source_storage.sql`.
- Validación/retención: `customerServiceEmailAttachments.ts` y adaptador
  `customerServiceEmailImportStorage.ts`, dentro de `supabase/functions/_shared`.
- Lectura autenticada: `customer-service-import-source` (POST con `importId` y
  `fileId`; nunca una ruta libre). URLs temporales de 300 segundos.
- Pruebas SQL: `customer_service_import_source_storage.test.sql`. La regresión
  `customer_service_imported_request_intake.test.sql` prepara su fuente sin
  adjuntos cuando está instalada la migración del bloque 3.

PDF, JPG/JPEG y PNG; máximo 10 archivos incluyendo inline, 10,000,000 bytes por
archivo y 50,000,000 por correo. Son MB decimales. No cambia el PDF manual de
10 MiB ni su bucket. Nombre, MIME y firma deben coincidir; no se certifica aún
la legibilidad completa del documento ni su extracción.

## Validación local

Desde `apps/backend`:

```powershell
npm run functions:test-email-import
npm run functions:check
```

Las pruebas usan archivos y transportes simulados: no leen un buzón ni suben
archivos al Supabase real. Cubren límites exactos, formatos/firmas, rechazo del
conjunto completo antes de escribir, inline, identidad estable, respuesta perdida,
interrupción, concurrencia y recuperación por SHA-256 sin reemplazo. No sustituyen
la suite SQL ni una prueba end-to-end real de Storage.

Resultado local: **53 pruebas nuevas aprobadas**, **26 regresiones** del flujo
manual de PDF/extracción aprobadas y **396 pruebas frontend aprobadas**. La
migración y las suites SQL tuvieron análisis sintáctico estático al entregar el
bloque. La verificación remota posterior aprobó las ocho suites de esta guía;
no sustituye una prueba end-to-end de binarios, permisos humanos y Storage.

## Aplicación realizada por el usuario — comandos de referencia

Desde `apps/backend`, revisar primero el inventario y el SQL pendiente:

```powershell
npx supabase migration list
npm run db:push -- --linked --dry-run --skip-vault
```

Confirmar que solo se aplicará la migración esperada. Si aparecen otras pendientes,
revisarlas antes de continuar; no usar `--include-all` ni editar migraciones ya
aplicadas. Después, cuando se apruebe el resultado del dry-run:

```powershell
npm run db:push -- --linked --skip-vault
npx supabase migration list
npm run db:test -- customer_service_import_source_storage.test.sql customer_service_imported_request_intake.test.sql customer_service_request_intake_schema.test.sql customer_service_email_import_registry.test.sql customer_service_source_pdf_storage.test.sql customer_service_intake_read.test.sql customer_service_intake_update.test.sql customer_service_request_ready.test.sql
```

Son pruebas contra el proyecto remoto vinculado, con fixtures y ROLLBACK. Las
filas de `storage.objects` de la prueba son metadatos sintéticos; no se crean
binarios reales. No requieren Docker ni un stack local.

Una vez aprobadas, desplegar únicamente la nueva función de lectura:

```powershell
npm run functions:deploy -- customer-service-import-source
```

Mantener `verify_jwt = true`. No requiere una clave nueva del proveedor de IA o
Microsoft. El módulo de subida no tiene endpoint público: se incorporará al
futuro procesador/worker, usando el cliente del servidor y esquema `valtrim`.

## Contrato para el siguiente bloque

1. Registrar identidad estable y metadatos mínimos, incluido el `webLink` real
   del proveedor, con `register_customer_service_email_import`.
2. Entregar cuerpo/metadatos normalizados y **todos** los adjuntos descargados
   a `persistCustomerServiceEmailSource`. No incluir binarios/base64 ni un campo
   `attachments` dentro de `source`: el servidor lo genera desde el manifiesto.
3. Un incumplimiento deja REJECTED/NEEDS_ATTENTION, motivo y enlace, sin cuerpo,
   request ni archivos. Un replay no puede eliminar el adjunto rechazado para
   convertirlo silenciosamente en un correo aceptado.
4. Un fallo de infraestructura puede dejar objetos válidos privados en UPLOADING,
   sin publicar referencias ni crear request. Reintentar el mismo manifiesto
   recupera las cargas; no se borran objetos potencialmente confirmados. El
   proceso del worker que retoma trabajo tras reiniciar corresponde a su bloque.
5. Solo `sourceStatus: AVAILABLE` habilita análisis y guardado estructurado del
   bloque 2. `AVAILABLE` no significa request creada ni `READY_TO_PROPOSE`.
6. El panel Correos con problemas y recuperación con PDF/formulario existente
   siguen pendientes del bloque UI, incluida la entrada de guardado humano
   vinculada al ID de importación. No debe simularse recuperando un REJECTED por
   el guardado automático ni exponiendo credenciales del servidor al navegador.
   No hay cambio visual en este bloque.

La fuente original/manifiesto no se reemplazan después de fijarlos. SQL publica
todos los vínculos juntos, pero no existe una transacción única con Storage.
Los errores de transporte no deben contener cuerpos del correo, secretos ni
URLs firmadas. La función de lectura solo entrega archivos del conjunto completo
a un ADMIN/SCHEDULING activo. Las requests anteriores conservan replay LEGACY,
sin inventar archivos ausentes ni cambiar el trabajo revisado por una persona.
