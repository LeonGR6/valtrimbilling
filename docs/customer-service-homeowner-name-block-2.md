# Reintento selectivo del nombre del propietario — bloque 2

Implementado localmente el 2 de noviembre de 2026. Migración y despliegues
pendientes de ejecución por el usuario. Complementa el
[extractor del bloque 1](customer-service-homeowner-name-block-1.md).

## Comportamiento

El botón existente **Reintentar análisis** conserva importId, correo y checkpoints.
No crea otra importación ni modifica una request ya vinculada.

Si el informe anterior está NEEDS_ATTENTION por
MISSING_OR_AMBIGUOUS_HOMEOWNER, se vuelve a analizar únicamente el fragmento
EMAIL antiguo que conserva un HOMEOWNER sin nombre. Se siguen comprobando
texto, offsets e identidad antes de reutilizar fuentes. Un fragmento con nombre
válido, una imagen o un PDF correctos conserva su análisis. No se convierte
sourceLabel en un nombre ni se sustituye al propietario por el builder.

Una extracción EMAIL nueva y válida guarda `contactNameVersion: 1`, un entero
de metadatos dentro del análisis. Un checkpoint histórico puede seguir sin esa
propiedad. No se marca como actualizado un resultado antiguo solo por leerlo.
La marca se conserva en continuaciones incluso si el informe combinado todavía
es el anterior. Así no se paga de nuevo por texto que ya se corrigió.

Si la extracción válida sigue sin nombre, queda NEEDS_ATTENTION: otro reintento
reutiliza ese resultado, sin repetir indefinidamente la misma corrección. La
captura humana sigue disponible. Un fallo del proveedor no obtiene esa marca;
usa los límites, esperas y errores visibles existentes. Una respuesta de IA
perdida antes de guardar su checkpoint todavía puede exigir repetir esa llamada;
no se garantiza una única llamada pagada ante fallos de red.

Las imágenes nuevas siguen en memoria. Reutilizar sus checkpoints no descarga
de Graph ni Storage, no repite visión y no crea archivos ni referencias de
imagen. La compatibilidad PDF y V1 continúa. Crear exige el mínimo validado y
deja NEEDS_REVIEW, con aprobación humana pendiente.

## Cambios y validación

- Analizador: versión opcional de texto y selección de fragmentos incompletos.
- Adaptador: habilita esa revisión solo ante el motivo de propietario faltante
  en el informe previo. Un informe READY_FOR_INTAKE conserva su vía de caché.
- Migración nueva `20261102180000_customer_service_email_text_analysis_version.sql`:
  permite la propiedad opcional en el validador V2 compartido por checkpoints e
  informes. Exige EMAIL/ANALYZED y entero positivo de 32 bits; conserva las demás
  validaciones, identidades, límites y rechazo de binarios. No agrega tablas,
  columnas ni modifica migraciones aplicadas o datos históricos.
- No cambia cron, sincronización, permisos del botón ni la API de reintento.
  No reencola automáticamente las importaciones en NEEDS_ATTENTION.

Pasaron **171 pruebas Deno**, tipos de worker, retry y extracción PDF manual,
y **tres suites pgTAP remotas**: reparación del texto, worker de imágenes y
recuperación. La migración se probó dentro de BEGIN/ROLLBACK con el runner del
proyecto: no quedó aplicada ni se modificó el historial de migraciones.
Los registros de prueba se revierten; las secuencias de folio pueden avanzar,
como en las demás pruebas de creación contra la BD remota.

Las pruebas cubren el nombre mal colocado con dos imágenes correctas, texto
válido antiguo, resultado aún incompleto, fallo temporal, continuación entre
fragmentos, duplicados, revisión humana, versiones inválidas, reserva caducada,
V1/V2 y ausencia de nuevos objetos/registros/binarios de imagen. Se usaron
proveedores y archivos simulados; no se invocaron Graph o Mistral reales.

Para repetir la validación antes de aplicar:

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npm run db:test -- --preview-migration 20261102180000_customer_service_email_text_analysis_version.sql customer_service_email_text_repair.test.sql customer_service_image_worker.test.sql customer_service_email_recovery.test.sql
npm run functions:test-email-analysis
npm run functions:test-email-worker
npm run functions:test-email-retry
npm run functions:check-email-worker
npm run functions:check-email-retry
```

## Aplicación y despliegue conjunto de bloques 1 y 2

Desde backend, comprobar primero que el listado y dry-run muestren la nueva
migración pendiente esperada. Aplicar la migración antes de desplegar las
funciones que enviarán la propiedad nueva. El código actualmente desplegado
sigue siendo compatible con el validador ampliado durante el despliegue.

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npm run db:test -- customer_service_email_text_repair.test.sql customer_service_image_worker.test.sql customer_service_email_recovery.test.sql
npx supabase functions deploy customer-service-email-worker --use-api
npx supabase functions deploy customer-service-email-retry --use-api
```

No requiere secretos nuevos, desplegar sync/reconcile, activar cron de nuevo ni
publicar frontend. Si el CLI solicita la contraseña de BD, usar la contraseña
del proyecto vinculado; no es el secreto del correo y no debe pegarse en el chat.

## Recuperación real pendiente

Una vez confirmados los despliegues, mantener el correo en Customer Service.
Con un usuario ADMIN/SCHEDULING, abrir **Requests → Correos con problemas**,
seleccionar la importación `2965cf60-2267-4f38-950c-ffd495d31df3` y utilizar
**Reintentar análisis → Confirmar reintento**. No mover el correo para crear otra entrada.

Comprobar la misma importación, nombre explícito correctamente extraído, dos
imágenes reutilizadas y una sola request NEEDS_REVIEW. Si sigue faltando el
nombre, revisar el informe y completar mediante captura humana; no repetir
sin límite. Si hay una continuación, el panel permite continuar el mismo
proceso cuando corresponda. La revisión visual de campos y la aprobación
siguen siendo humanas. Esta implementación local no acredita todavía que el
piloto real se haya recuperado; su resultado original se conserva en
[la prueba automática](customer-service-email-automatic-test-2026-11-02.md).

Actualización posterior del 2 de noviembre: el usuario ejecutó el reintento y
la BD confirmó la misma importación PROCESSED y una sola request **CS-2031**
(ID 1031), NEEDS_REVIEW, sin errores pendientes de importación. Se conservaron
las dos fuentes IMAGE analizadas y el texto quedó con contactNameVersion 1.
La revisión y aprobación humanas siguen pendientes. El registro enlazado
documenta además la corrección local del aviso histórico del worker en frontend.
