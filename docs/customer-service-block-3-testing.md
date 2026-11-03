# Customer Service — pruebas del bloque 3

Mark ready to propose persistente, implementado el 20 de octubre de 2026.
Requiere los bloques 1 y 2. La migración se confirmó aplicada el 20 de octubre
de 2026 durante el bloque 4; no hay cambios de Edge Functions.
Borradores y programación siguen en memoria. No se envían correos, no se crean
citas. Las dos requests antiguas se eliminaron posteriormente en el bloque 4;
ver su [resultado y regresión global](customer-service-block-4-testing.md).

## Despliegue de base de datos

Revisar la lista y el dry-run: db push incluye **todas** las migraciones pendientes
del checkout, no solo `20261020190000_customer_service_request_ready.sql`.

```powershell
cd C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npm run db:test -- customer_service_request_ready.test.sql customer_service_intake_update.test.sql customer_service_intake_read.test.sql customer_service_request_intake_schema.test.sql customer_service_request_intake_rpc.test.sql customer_service_source_pdf_storage.test.sql customer_service_crud.test.sql
```

No usar Docker ni una base local. Para validar solo la aprobación después del
despliegue: `npm run db:test -- customer_service_request_ready.test.sql`.

## Frontend

```powershell
cd C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\frontend
npm test
npm run build
npm run dev
```

Las pruebas automatizadas cubren la espera sin cambios optimistas, token exacto
con microsegundos, datos canónicos, error/reintento sin cambios locales, revisión
restaurada en otra sesión, confirmación literal y validación previa de Job/crew.
El pgTAP verifica permisos, validaciones, auditoría, historial único, identidad y
fuente inmutables, no creación de cita, concurrencia y rollback de una falla
después de escribir estado/historial. Sus actores y requests usan rollback.

## Pruebas manuales después del despliegue

Usar un usuario activo ADMIN o SCHEDULING y solicitudes de prueba identificadas.
Los cambios guardados manualmente sí son reales. No hace falta SQL manual para
poner requests en READY_TO_PROPOSE.

1. **Información pendiente.** Crear una request con los mínimos de Save for
   review pero sin clasificación/tarea/duración/crew. Abrir View/Review: Mark
   ready está deshabilitado y muestra los pendientes. Editar, completar y guardar.
   Se requieren Job/Builder activos, coordenadas del Job, contacto principal y
   cualquier adicional con nombre y correo o teléfono válidos, clasificación,
   ítems descritos, duración de 15–720 y crew de 1–10. Shutter requiere mínimo 2.
2. **Confirmación humana.** Con todos los checks completos, el botón sigue
   deshabilitado hasta marcar que los ítems corresponden a Valtrim. Las notas
   de IA se muestran, pero por sí solas no bloquean. PDF/texto son opcionales.
3. **Éxito persistente.** Anotar folio y datos de la fuente. Aprobar: debe mostrar
   Approving y luego READY_TO_PROPOSE, usuario revisor y hora de California. Recargar y abrir:
   mismo folio, misma revisión y mismo contenido. Abrir Proposal Workspace:
   aparece como Ready to propose, sin cita ni correo enviado.
4. **Espera y doble clic.** Activar Slow 3G en DevTools antes de aprobar otra
   request. Durante la operación se bloquean botón, confirmación, Edit y cierre.
   No cambia de estado antes de la respuesta ni hay dos aprobaciones por doble clic.
5. **Falla y reintento.** Abrir Review completo, confirmar Valtrim, pasar Network
   a Offline y aprobar. El error aparece en el diálogo, sin cerrarlo ni aprobar
   localmente. Volver a Online y reintentar. Si solo se perdió la respuesta pero
   sí se guardó, puede recibirse versión obsoleta: cerrar y recargar para comprobar
   el resultado; nunca crear una segunda request para reintentar.
6. **Dos pestañas.** Abrir Review de la misma NEEDS_REVIEW en B. En A editar y
   guardar (incluso solo notas). Aprobar desde B: debe rechazar la versión anterior
   sin sobrescribir A. Cerrar, recargar, revisar los datos actuales y confirmar de
   nuevo. Si A ya aprobó, B tampoco puede generar otra transición.
7. **Job actualizado.** En una request aún en revisión, cambiar las coordenadas
   verificadas de su Job de prueba desde Jobs. Intentar aprobar sin volver a
   guardar la request: debe pedir editar/guardar y revisar la ubicación actual.
   No aprobar silenciosamente otra ubicación. Repetir con un Job/Builder inactivo
   debe rechazar la aprobación hasta corregir la selección. Restaurar después
   cualquier cambio manual hecho al Job de prueba.
8. **Invalidación y nueva revisión.** Aprobar, luego editar un ítem, Material,
   Chargeable, clasificación, Job/ubicación, duración o crew. Guardar: vuelve a
   NEEDS_REVIEW y limpia revisión/confirmación. Recargar conserva la invalidación.
   Revisar y aprobar de nuevo: guarda otra transición válida, con revisor/hora nuevos.
9. **Cambios administrativos.** En una aprobada, cambiar solo prioridad/notas o
   corregir un contacto conservándolo válido. Guardar y recargar: sigue aprobada
   y conserva la revisión. Los cambios de alcance del punto anterior sí la invalidan.
10. **Fuente y límites del bloque.** Comparar View source & extraction antes y
    después de aprobar/recargar: mismo PDF privado, correo, OCR, JSON y advertencias.
    Una carga PDF FAILED/PENDING conserva su estado real. Aprobar no lo reintenta
    ni lo presenta como disponible. Preparar un borrador sigue siendo simulación
    de sesión; su pérdida al recargar no debe eliminar la aprobación persistida.

## Alcance de la verificación de esta tarea

Verificado: 379 pruebas frontend, build y lint de los archivos modificados; la
suite nueva de aprobación y las seis suites previas pasaron con la migración
nueva aplicada exclusivamente dentro de transacciones con rollback. La
comprobación manual en navegador queda para después del despliegue.

Se ejecutan las siete suites relacionadas contra el proyecto vinculado. Para
probar sin desplegar, la migración nueva se incluye al inicio de cada suite en
una transacción que termina en rollback. No se aplica db push ni se llama a
Storage/SMTP real. La regresión completa del repositorio y la eliminación
dirigida de los datos antiguos quedan para el bloque 4.
