# Corrección de idioma y correos pendientes — 2 de noviembre de 2026

## Causa comprobada

La consulta remota mostró **0 importaciones fallidas y 2 correos sin vínculo**.
Los originales Dayspring e Indigo están en el inventario con identidades Graph
diferentes de las copias reenviadas que generaron requests. CS-2022 y CS-2031
existen, pero no hay confirmaciones guardadas para esos originales.

El estado se deriva en `private.customer_service_email_inbox_items`:

- Los originales figuran en `private.customer_service_email_missing_messages`.
- Al faltar un vínculo válido en
  `private.customer_service_email_message_resolutions`, aparecen como
  REQUIRES_ACTION con motivo NO_IMPORT.
- La etapa NEEDS_REVIEW de una request indica revisión humana pendiente y se
  muestra por separado. No representa un error del correo.

Crear o reanalizar una copia no confirma automáticamente la identidad del
original. Coincidir en asunto, domicilio o propietario no basta para descartar
otro caso legítimo. El vínculo se confirma con la RPC existente, versión y
auditoría. Si su request se elimina legítimamente, el vínculo se invalida y el
correo vuelve a revisión.

## Cambio preparado

Toda la copia de la bandeja, conexión, confirmaciones, reintentos y errores
mostrados por sus repositorios está en inglés. Los mensajes técnicos guardados
se presentan mediante textos de producto en inglés; no se muestran diagnósticos
crudos. Los asuntos y datos originales conservan su idioma. AGENTS.md registra
esta regla para futuros cambios.

La migración nueva añade `unmatched` e `importIssues` al contador existente;
preserva el total `requiresAction`, permisos y estados para clientes anteriores.
El frontend valida la suma de ambas categorías y muestra valores desconocidos
si el servidor no puede confirmar los contadores. **Instalar SQL antes del
frontend**, que requiere los campos nuevos.

La cabecera muestra **Emails to match**, **Import issues**, **Processing** y
**Registered emails**. Un original NO_IMPORT muestra **Unmatched email** y una
explicación con su botón **Match existing request** directamente en la fila.
Un fallo real sigue mostrando **Import issue**; un vínculo invalidado muestra
**Request link missing**. El filtro común **To review** reúne los pendientes
con su motivo específico. No se añaden etapas a la request.

La acción directa vuelve a leer el correo y captura su versión actual antes
de abrir el diálogo. No preselecciona una request. Exige comprobar propietario,
dirección y trabajo, elegir el destino y marcar la confirmación. Después de
guardar, vuelve a consultar el resultado real, actualiza contadores y muestra
el folio. Un resultado incierto exige refrescar y bloquea repetir la mutación
hasta verificarlo. No se crea otra request ni se consume IA por vincular.

## Uso con los dos originales reales

Después de instalar y cargar el frontend actualizado:

1. Abrir Customer Service / Requests / **View emails**.
2. En Dayspring, pulsar **Match existing request**. Abrir el original y comparar
   los propietarios, domicilio y trabajo con CS-2022 antes de seleccionarla.
3. Marcar **I reviewed the details and confirm this is the same case.** y pulsar
   **Confirm match** únicamente si corresponde. Debe quedar Registered con su
   folio y bajar **Emails to match** en uno.
4. Repetir la comparación del original Indigo con CS-2031. Si ambos vínculos se
   confirman correctamente, el contador de estos dos pendientes queda en cero.
5. Revisar **Registered** y sus enlaces. La aprobación humana de las requests
   continúa pendiente. No subir copias nuevas para limpiar estos avisos.

Esta corrección no confirmó los vínculos de producción ni eliminó sus avisos
mediante cambios de datos. El piloto con la sesión real continúa pendiente.

## Validación

- 492 pruebas frontend pasaron: incluye separación de categorías, contadores
  incoherentes, lectura de versión al vincular, errores seguros en inglés,
  confirmación perdida, lectura posterior, concurrencia y revisión humana.
- Lint completo y build frontend pasaron. Se conserva el aviso preexistente
  de tamaño de un chunk de Vite.
- Tres suites pgTAP remotas pasaron con la migración en BEGIN/ROLLBACK:
  `customer_service_email_review_counts.test.sql`,
  `customer_service_email_message_resolution.test.sql` y
  `customer_service_email_inbox_metadata.test.sql`.
- Playwright CLI comprobó con datos simulados los dos vínculos, sus folios y
  contador cero: dos confirmaciones, ningún reintento ni llamada a IA.
- A 390 px se comprobó un resultado inicialmente incierto que luego se verificó
  con Refresh status: desapareció la advertencia, solo hubo un reintento y
  ninguna vinculación, sin desbordamiento horizontal.

Los fixtures SQL se revierten; las secuencias de folios de las pruebas existentes
pueden avanzar. No se invocaron Graph/Mistral reales ni se procesaron imágenes.
No se aplicaron migraciones ni desplegaron funciones durante esta corrección.

Evidencia local: `output/playwright/customer-service-inbox-english-dialog.png`,
`customer-service-inbox-english-registered.png` y
`customer-service-inbox-english-mobile.png`, junto con los scripts de prueba
`customer-service-inbox-english-match.js` y `customer-service-inbox-english-retry.js`.

## Instalación por el usuario

Desde PowerShell, comprobar que el dry-run incluye únicamente las migraciones
previstas antes de aplicar:

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npm run db:test -- customer_service_email_review_counts.test.sql customer_service_email_message_resolution.test.sql customer_service_email_inbox_metadata.test.sql

Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling'
npm run build
```

El build no publica por sí solo. Publicar el frontend con el proceso habitual
del proyecto, o recargar la versión actualizada si se trabaja en desarrollo.
**No requiere desplegar Edge Functions, nuevos secretos ni reiniciar cron.**
Se conservan las migraciones aplicadas y los despliegues actuales de sync,
reconcile, worker y retry. No cambia la retención de imágenes o PDF.

Para validar sin aplicar la migración:

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npm run db:test -- --preview-migration 20261102220000_customer_service_email_review_counts.sql customer_service_email_review_counts.test.sql customer_service_email_message_resolution.test.sql customer_service_email_inbox_metadata.test.sql
```
