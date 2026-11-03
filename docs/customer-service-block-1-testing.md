# Customer Service — pruebas del bloque 1

Implementado el 20 de octubre de 2026: lectura y creación desde Supabase, carga,
error/reintento, lista vacía real, lectura canónica tras crear y reintento del PDF
sin duplicar requests. Esta guía documenta el alcance inicial del bloque 1.
La edición se incorpora en el [bloque 2](customer-service-block-2-testing.md);
aprobación y planificación siguen pendientes de integración.

## Despliegue de base de datos

No se ha aplicado permanentemente la nueva migración desde esta tarea. Revisar
la lista y el dry-run: la nueva migración de este bloque es
`20261020150000_customer_service_intake_read.sql`. Requiere las migraciones
anteriores de intake y PDF. El dry-run muestra todas las migraciones pendientes;
revisar ese resultado antes de ejecutar push.

```powershell
cd C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npm run db:test -- customer_service_intake_read.test.sql customer_service_request_intake_schema.test.sql customer_service_request_intake_rpc.test.sql customer_service_source_pdf_storage.test.sql customer_service_crud.test.sql
```

El bloque no cambia Edge Functions. Usa `customer-service-source-pdf` para subir
y abrir el PDF. Solo si esa función anterior aún no está publicada:

```powershell
npx supabase functions deploy customer-service-source-pdf --use-api
```

La extracción IA usa `extract-customer-service-pdf`, ya integrada. No requiere
redespliegue por este bloque. La creación manual y el texto ya analizado se
guardan sin volver a ejecutar Mistral durante Save.

## Verificación automatizada

```powershell
cd C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\frontend
npm test
npm run build
npm run dev
```

Comprobado durante la implementación: 370 pruebas frontend, build y lint de los
archivos modificados correctos. Pasaron las cuatro suites remotas de línea base
(CRUD, intake schema, intake RPC y PDF). También pasó el nuevo pgTAP de lectura
ejecutado junto con su migración dentro de una transacción con rollback: esa
verificación no deja el RPC desplegado. La prueba de UI con la migración publicada
queda a cargo de los siguientes pasos.

## Pruebas en el navegador

Iniciar sesión con un usuario activo ADMIN o SCHEDULING. Los datos de prueba que
se creen aquí son registros reales y permanecen guardados. No se eliminan los dos
registros de prueba anteriores como parte de este bloque.

1. **Lectura:** abrir Customer Service → Requests. Ver carga y después los datos
   remotos, sin las requests del fixture. Buscar por un folio existente y abrir
   Review request. Los registros antiguos sin Job siguen sin Job; no se les
   inventa una relación.
2. **Captura manual:** New request → capturar Reported on, Builder, Project/Job,
   cliente, correo o teléfono y al menos un ítem descrito. Clasificación, Service
   task, duración y crew pueden quedar pendientes. Save for review debe mostrar
   Saving y bloquear campos/cierre hasta terminar; después abrir el registro
   guardado en NEEDS_REVIEW con folio CS-. Anotar el folio.
3. **Recarga:** recargar el navegador y buscar ese folio. Deben conservarse Job,
   coordenadas del Job, contacto e ítems. Volver a abrir la vista para confirmar
   la misma información. Navegar entre vistas y volver tampoco pierde la request.
4. **Datos completos:** crear otra request con contacto adicional válido, varios
   ítems con Material/Chargeable distintos, clasificación, duración y crew.
   Recargar y comprobar cada valor y el orden de los ítems. La fecha límite
   conserva el quinto día hábil posterior a Reported on.
5. **Correo fuente:** crear con texto pegado del correo. Recargar y abrir
   View source & extraction. Se conserva el correo, sus advertencias y, si hubo
   extracción exitosa, el texto analizado y JSON. Una captura manual informa que
   no tiene fuente.
6. **PDF:** crear con un PDF de hasta 10 MB. Tras guardar y recargar, el visor
   permite abrir/descargar el PDF original mediante enlace privado temporal y
   consultar OCR/JSON si se extrajeron. No depende de un File en memoria.
7. **Error de creación:** con el formulario manual completo, usar DevTools →
   Network → Offline antes de Save. Debe permanecer abierto, conservar la captura
   y mostrar error. Volver a Online y reintentar: aparece una sola request. No se
   muestra éxito mientras el servidor no responde.
8. **Error de lectura:** estando autenticado, bloquear temporalmente las peticiones
   que contengan `read_customer_service_request_intakes` y recargar. Aparece error
   con Retry, sin mostrar fixtures como respaldo. Desbloquear y pulsar Retry:
   vuelve la lista remota. Para observar el indicador de carga, usar Slow 3G.
9. **Fallo parcial del PDF:** después de analizar el PDF, bloquear únicamente
   `customer-service-source-pdf` desde DevTools → Network request blocking y
   guardar. Se informa que el folio ya fue guardado, el formulario permanece
   abierto y sus campos quedan bloqueados. Desbloquear y pulsar Retry saved
   request: conserva el mismo folio y aparece una sola vez al recargar.
10. **Reintento después de cerrar:** repetir el fallo anterior, cerrar el
    formulario y abrir el PDF de esa request desde la lista. Durante la misma
    sesión aparece Retry PDF; desbloquear y reintentar. Si se recarga antes de
    reintentar, la request, extracción y estado de fallo se conservan, pero el
    archivo local se pierde y el visor informa que no está disponible. No se
    permite reemplazar el PDF desde edición.
11. **Límites del bloque:** el bloque 1 por sí solo no certifica edición ni
    aprobación persistentes. Después de desplegar el bloque 2, las ediciones
    sí se conservan al recargar. Mark ready continúa simulado hasta el bloque 3.

El vacío real y las respuestas obsoletas están cubiertos por las pruebas
automatizadas. No borrar solicitudes para provocar una lista vacía en la BD.
