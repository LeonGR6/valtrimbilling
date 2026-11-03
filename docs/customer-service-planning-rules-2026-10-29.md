# Planificación compartida de Customer Service — 29 de octubre de 2026

## Resultado preparado

El usuario autorizó unificar las sugerencias de clasificación y planificación y
pidió ejecutar él los despliegues. El código está implementado localmente. No
se desplegaron funciones, publicó el frontend ni aplicaron migraciones en esta
entrega. No se reencoló, editó o aprobó una request real.

**Confirmación posterior del 29 de octubre:** el usuario realizó los despliegues.
Se verificaron worker ACTIVE **v15** y retry ACTIVE **v11**. Se descargó cada
paquete por API en una carpeta aislada y se comparó con las fuentes locales:
**21/21 archivos del worker y 23/23 del retry coinciden**, incluido el módulo
customerServicePlanning.mjs y el intake que envía duración/crew. Las versiones
permanecieron iguales al finalizar la comprobación. OPTIONS respondió 405 en
worker (su handler admite únicamente POST) y 200 en retry, sin errores de runtime.
No se invocó POST ni procesaron correos durante esta verificación. Evidencia
local: `apps/backend/supabase/.temp/verify-planning-deploy-20261029/source-comparison.json`.
La publicación del frontend no se comprobó. Este cambio sigue sin requerir
migración y no modifica automáticamente CS-1974.

La comprobación de solo lectura del JSON real de **974 / CS-1974** confirmó que
ya tenía Adjustment y GENERAL_FIX, pero work_category, duración y crew guardados
eran null. Ejecutar las reglas nuevas en memoria propone **Adjustment / Doors /
GENERAL_FIX / 30 minutos / 1 persona** y conserva sus fuentes intactas.

## Código y comportamiento

- `apps/backend/supabase/functions/_shared/customerServicePlanning.mjs` es el
  módulo puro compartido: catálogos de kind/work type/task, inferencia existente
  del frontend y cálculo de duración/crew. No depende de React, SDK, red o IA.
- El frontend lo importa mediante una fachada local; Vite incluye el módulo en
  su build y las Edge Functions lo incluyen como dependencia relativa. Se
  mantienen los exports anteriores de newRequestPrototype y workTypes para sus
  consumidores existentes, sin catálogos/cálculos duplicados.
- El importador usa todos los ítems incluidos con descripción o acción. Conserva
  los originales y añade al payload las sugerencias estimatedDurationMinutes y
  crewSize, con advertencias de revisión. Se excluyen los trabajos explícitamente
  asignados a otro proveedor antes de contar o clasificar. Una contradicción
  explícita detectada al combinar fuentes no se rellena por una inferencia.
- Una clasificación/tarea global requiere acuerdo del alcance completo; no
  toma la del primer ítem. Work types distintos producen Multiple work types;
  tareas distintas dejan tarea/duración/crew pendientes. Un ítem vacío no aumenta
  la cuenta de General fix. Los umbrales siguen siendo 1–6 → 30, 7–9 → 45,
  10 o más → 60 minutos. El mínimo de trabajo requerido permanece vigente.
- La extracción manual PDF/texto usa la misma regla global y calcula General fix
  sobre los ítems descritos incluidos, sin depender del primer ítem seleccionado.
- Al abrir Edit de una NEEDS_REVIEW, el formulario propone solo campos vacíos de
  servicio y planificación. Los valores proporcionados, incluso los inválidos,
  se conservan para validación; no se corrigen silenciosamente. La información
  fuente se usa solo cuando coincide con una descripción actual única.
- Una duración vacía ya no se identifica como edición manual. Cambiar el número
  de ítems actualiza General fix mientras no haya override manual durante la
  edición. Un valor guardado distinto del cálculo se conserva como antes. Una
  nueva selección explícita de tarea y Use suggested duration mantienen su
  comportamiento para volver a las referencias del catálogo.
- La propuesta inicial se aplica una sola vez por edición de la request: borrar
  un campo posteriormente no lo rellena otra vez. Se muestra un aviso de
  sugerencias pendientes, se marca dirty y cerrar ofrece descartar/seguir
  editando. Solo Save changes persiste por el RPC existente y su versión exacta.
- View, estados bloqueados y una captura nueva vacía conservan sus valores sin
  autocompletado. La comprobación de aprobación sigue usando lo realmente
  guardado; las propuestas sin guardar no convierten una request en aprobada.

## Validación

- 464 pruebas frontend aprobadas, incluidas ocho nuevas de planificación.
- 83 pruebas de análisis/importador y 44 de worker aprobadas. Incluyen los
  umbrales de General fix, exclusión de otro proveedor, conflictos entre fuentes,
  tareas diferentes, Shutter replacement 120/2 y fuentes/cachés intactos.
- Tipos de worker/retry, lint backend/frontend y build frontend aprobados.
- `npm run db:test -- customer_service_imported_request_intake.test.sql` pasó
  contra la BD remota enlazada, con los fixtures dentro de ROLLBACK. El contrato
  existente ya admite duración y crew; no se necesita una migración nueva.
- Comprobación en memoria del JSON real: Doors/General fix/30/1, sin fuente
  modificada, nueva inferencia o escrituras en la request.
- Playwright con el componente real y datos sintéticos, bloqueando backend real:
  General fix ya seleccionado con campos vacíos recibe Doors/30/1; antes de
  guardar el callback no se ejecuta y el original está intacto; cerrar avisa de
  cambios sin guardar y Save changes envía los valores propuestos. Siete ítems
  reciben 45 y dejar uno vacío cambia a 30; duración 80 y crew 3 manuales se
  conservan al volver a siete. View y CONFIRMED conservan sus valores originales;
  abrir una captura nueva mantiene clasificación, tarea, duración y crew vacíos.
  En 390 px no hubo desbordamiento horizontal y se mantuvieron 30/1 sin guardar.

## Despliegues que ejecutará el usuario

No hay comando de migración para este cambio. Desde PowerShell:

```powershell
Set-Location "C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend"
npx supabase functions deploy customer-service-email-worker --use-api
npx supabase functions deploy customer-service-email-retry --use-api
```

El conector customer-service-email-sync y las funciones de archivos/PDF no
cambian. No activar cron como parte de esta entrega.

Actualizar también el frontend. El build puede generarse desde la raíz:

```powershell
Set-Location "C:\Users\u\Documentos\Proyectos\ValtrimBilling"
npm run build
```

Este comando genera dist/client; no publica el sitio. Usar el flujo de hosting
habitual para publicar ese frontend, o recargar la aplicación de desarrollo.

**CS-1974 ya procesada:** el despliegue no reescribe su historial ni sus datos.
Abrir Edit con el frontend actualizado, revisar Doors/General fix/30/1 y pulsar
Save changes para guardar en la misma request. Si faltan Job u otros requisitos,
siguen pendientes. Mark ready to propose conserva su revisión humana separada.
