# Customer Service — pruebas del bloque 2

> Esta guía conserva el estado del bloque 2. El bloque 3 ya incorpora aprobación
> real; después de desplegarlo, usar también la [guía del bloque 3](customer-service-block-3-testing.md).

Implementado el 20 de octubre de 2026: edición persistente de la misma request.
Incluye actualización atómica, conservación de folio/fuente, validación en el
servidor, versión para evitar sobrescrituras, invalidación de revisión y auditoría.
El formulario espera el RPC, bloquea sus controles mientras guarda y mantiene
los datos capturados si hay error.

## Despliegue

La migración nueva es `20261020170000_customer_service_intake_update.sql` y aún
no se ha desplegado permanentemente desde esta tarea. El bloque 1 ya pasó sus
cinco suites remotas de línea base. Revisar el dry-run antes del push: ese comando
incluye todas las migraciones pendientes del checkout.

```powershell
cd C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npm run db:test -- customer_service_intake_update.test.sql customer_service_intake_read.test.sql customer_service_request_intake_schema.test.sql customer_service_request_intake_rpc.test.sql customer_service_source_pdf_storage.test.sql customer_service_crud.test.sql
```

No hay cambios ni despliegue de Edge Functions para este bloque. El visor sigue
usando `customer-service-source-pdf`, ya existente.

## Pruebas automatizadas

```powershell
cd C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\frontend
npm test
npm run build
npm run dev
```

Verificado: 374 pruebas frontend, build y lint de los archivos modificados. El
pgTAP nuevo pasó aplicando su migración solo dentro de una transacción con
rollback. También pasaron las cinco suites previas contra esa misma migración
dentro de transacciones con rollback, sin dejarla desplegada.

El pgTAP crea actores y requests temporales en la transacción. Comprueba permisos,
actualización completa, fuente/PDF/OCR/JSON inmutables, contactos e ítems, límites,
coordenadas derivadas del Job, control de versión, estados protegidos, auditoría,
propiedades compartidas y rollback por una falla posterior a las primeras
escrituras. No elimina las dos requests de prueba anteriores.

## Pruebas manuales después de desplegar

Usar un usuario activo ADMIN o SCHEDULING. Los cambios que se guarden aquí son
reales; elegir requests de prueba identificadas para esta validación.

1. **Editar y recargar.** En Requests, abrir Edit en una solicitud NEEDS_REVIEW.
   Anotar el folio, cambiar un ítem y notas, guardar y recargar. Debe mantenerse
   el folio y aparecer el contenido nuevo. No debe crearse otra solicitud.
2. **Contactos e ítems.** Cambiar el contacto principal y el adicional; alternar
   correo/teléfono válidos sin exigir ambos. Añadir o quitar ítems y cambiar
   Material/Chargeable. Guardar y recargar: se conservan todos los valores y el
   orden. Probar también quitar el contacto adicional.
3. **Ubicación.** Seleccionar otro Builder/Job activo, guardar y recargar. La
   ubicación corresponde al Job elegido y sus coordenadas verificadas. Lot # y
   Address pueden quedar vacíos individualmente. Un Job inválido/inactivo o sin
   coordenadas válidas debe producir un error y mantener la captura abierta.
4. **Planificación pendiente y revisada.** Guardar clasificación, Service task,
   duración o crew pendientes cuando la request sigue en revisión; completar y
   guardar después. Las duraciones manuales se conservan. Los valores inválidos
   capturados no deben aceptarse.
5. **Fecha reportada.** Corregir Reported on y guardar. Tras recargar se conserva
   la fecha y Due on corresponde al quinto día hábil posterior; Created on no
   cambia.
6. **Fuente original.** Usar una request creada con PDF o texto analizado. Abrir
   View source & extraction antes y después de editar/recargar. Conservar el
   mismo PDF, correo, OCR, JSON y advertencias. From/Subject son referencia de
   solo lectura; la edición no permite reemplazar la fuente ni añadir un PDF.
7. **Esperar el servidor.** Activar Slow 3G en DevTools y guardar una edición.
   Debe aparecer Saving, bloquear campos/botones y evitar cerrar el diálogo hasta
   recibir respuesta. El éxito y el cierre solo ocurren después del servidor.
8. **Error y reintento.** Abrir un editor, cambiar notas y pasar Network a
   Offline antes de guardar. Debe mostrar error sin cerrar ni borrar la captura.
   Volver a Online y reintentar; verificar después de recargar. Si el primer
   intento alcanzó a guardarse y solo se perdió la respuesta, puede aparecer el
   aviso de versión obsoleta; recargar permite comprobar lo realmente guardado.
9. **Dos pestañas.** Abrir la misma request en Edit en dos pestañas. Guardar un
   cambio en A. Guardar desde B con la versión anterior: debe rechazarlo y
   conservar la captura de B. No debe sobrescribir A. Copiar cualquier texto que
   se quiera conservar, cerrar B, recargar y abrir nuevamente la request para
   revisar la versión actual antes de aplicar otra edición.
10. **Regresión de creación.** Crear una request nueva, guardar y recargar. Debe
    seguir en NEEDS_REVIEW con su mismo folio. La subida/consulta de PDF y el
    reintento del bloque 1 deben seguir funcionando.

## Revisión y estados posteriores

Antes del bloque 3, Mark ready era simulado. Tras desplegar el bloque 3, aprobar
desde Review y usar las pruebas manuales de su guía para comprobar invalidación
y conservación de la revisión; no sembrar estados manualmente en la base real.

Las siguientes reglas también se validan con pgTAP, sembrando los estados
únicamente dentro de la transacción de prueba:

- READY_TO_PROPOSE pierde su aprobación al cambiar ubicación, clasificación,
  ítems, duración o crew. Regresa a NEEDS_REVIEW y limpia reviewed_by,
  reviewed_at y valtrim_items_confirmed.
- Prioridad/notas y una corrección de contacto válida conservan una revisión
  persistida. Guardar valores idénticos no genera otra versión.
- Las solicitudes con propuesta enviada, confirmadas o en curso bloquean cambios
  operativos; sus guardados administrativos no normalizan registros antiguos.
- COMPLETED permite únicamente notas internas.

No es necesario modificar manualmente estados reales en la base para probarlos.
