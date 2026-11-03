# Customer Service — diagnóstico y plan ajustado de importación por correo

Fecha: 20 de octubre de 2026.

Actualización del 22 de octubre: el **bloque 1 del plan nuevo de importación**
corresponde al registro técnico (bloque 6 de la secuencia histórica de abajo).
Está preparado localmente en `20261022120000_customer_service_email_import_registry.sql`,
con su suite pgTAP. El usuario la aplicó y pasaron esa suite y las cuatro
regresiones de captura en el remoto. El usuario también aplicó el bloque 2,
`20261022140000_customer_service_imported_request_intake.sql`: guardado estructurado
idempotente y formulario de revisión parcial. Compartió PASS de
`customer_service_imported_request_intake.test.sql` y
`customer_service_request_intake_schema.test.sql` (dos suites, cero fallidas).
Esos dos bloques no incluyen conector, procesamiento ni panel de problemas. Prevalecen las precisiones
vigentes sobre mínimo de propietario/ítem y panel de problemas dentro de Requests;
ver [reglas confirmadas](customer-service-business-rules.md) y
[contrato del bloque 1](customer-service-request-scheduling-spec.md#importación-por-correo--bloque-1-22-de-octubre-de-2026).

**Adjuntos confirmados el 22 de octubre, con activación pendiente:** PDF, JPG/JPEG y
PNG; 10 MB por archivo, 10 archivos por correo incluyendo imágenes inline y
50 MB de adjuntos por correo. Cualquier incumplimiento detiene todo ese correo:
sin request y sin archivos guardados parcialmente; sí registro técnico mínimo
NEEDS_ATTENTION, motivo y enlace al original. Mostrarlo en Correos con problemas
dentro de Requests y abrir el formulario existente para recuperación con PDF
válido/extracción semiautomática o, si falla, captura manual. El guardado crea
una sola NEEDS_REVIEW vinculada a esa importación. Este acuerdo sustituye la
opción de conservar solo los adjuntos válidos e importar parcialmente el correo.
El bloque 3 de archivos/validación fue aplicado/desplegado por el usuario:
`20261022160000_customer_service_import_source_storage.sql`, módulos del servidor
y función de lectura `customer-service-import-source`. El 22 de octubre se
verificaron migración, función ACTIVE v1/JWT, autenticación/preflight y ocho suites
SQL relacionadas aprobadas con ROLLBACK; transferencia binaria real no ejercida.
Panel y recuperación requieren su bloque UI posterior. Ver
[pruebas/activación del bloque 3 de correo](customer-service-email-import-block-3-testing.md).

El **bloque 4 de correo** prepara el análisis conjunto de cuerpo,
PDF, imágenes y campos PDF, evidencia/conflictos y propuesta parcial para el
guardado del bloque 2. No crea requests ni las aprueba; worker y Graph siguen
pendientes en esa entrega. El usuario aplicó la migración
`20261022180000_customer_service_import_analysis.sql`; se verificaron historial y
nueve suites relacionadas aprobadas en remoto con ROLLBACK. No se enviaron datos reales
a Mistral. Ver [pruebas y activación del bloque 4 de correo](customer-service-email-import-block-4-testing.md).

El **bloque 5 de correo** prepara localmente el worker que une análisis y guardado,
con reservas, avances por fuente, reintentos limitados y protección contra procesos
vencidos. Migración nueva `20261022200000_customer_service_email_worker.sql` y
Edge Function `customer-service-email-worker`, sin desplegar/activar. No instala
cron ni conecta Outlook. Ver [pruebas y activación del bloque 5 de correo](customer-service-email-import-block-5-testing.md).

Seguimiento: el usuario confirmó Microsoft 365 / Exchange Online. Ver el
[plan concreto del conector](customer-service-microsoft-365-intake.md).
La recuperación de PDF del bloque 5 está corregida en código y pendiente de
despliegue; ver [verificación y activación](customer-service-block-5-testing.md).
El usuario precisó además que la importación debe analizar el correo completo,
sus imágenes y PDF, guardarse como NEEDS_REVIEW y pasar a READY_TO_PROPOSE solo
después de la revisión/edición y el visto bueno humanos. Ese acuerdo amplía el
alcance inicial del conector; no certifica soporte de imágenes ya implementado.
El 21 de octubre confirmó que los datos faltantes no bloquean el registro
automático: crear la request NEEDS_REVIEW incompleta y completarla antes de la
aprobación humana. Esta decisión sustituye la recomendación anterior de dejar
esas entradas únicamente como importaciones pendientes sin request.

Este documento registra el análisis del código actual y las verificaciones de
esta revisión. Las fases propuestas no son reglas de negocio aprobadas ni una
integración desplegada. Prevalecen las
[reglas vigentes](customer-service-business-rules.md).

## Resultado

Continuar con el objetivo original, ajustando el plan a los bloques ya
desplegados. Reutilizar captura, lectura, edición, aprobación, fuente y Storage.
La nueva implementación corresponde a la recepción y procesamiento del correo,
con una corrección puntual de recuperación de PDF antes de automatizarlo.

El flujo objetivo sigue siendo carpeta del buzón → importación → extracción →
request NEEDS_REVIEW → revisión humana → READY_TO_PROPOSE. El servidor crea la
request; no depende de abrir automáticamente un formulario en el navegador.
La coordinadora abre después el formulario existente sobre el mismo folio.

## Base existente verificada

| Capacidad | Evidencia actual | Acción propuesta |
| --- | --- | --- |
| Guardar request, contactos e ítems con folio CS- y vencimiento | RPC `create_customer_service_request_intake`; clave de envío e inserción transaccional | Reutilizar validaciones e identidad |
| Leer registros reales al cargar y después de crear | `read_customer_service_request_intakes`, repositorio y store activos | Reutilizar contrato canónico |
| Editar la misma request | `update_customer_service_request_intake`, versión exacta, auditoría e invalidación de revisión | Mantener |
| Aprobar con revisión humana | `mark_customer_service_request_ready`, confirmación Valtrim, actor y hora del servidor | Mantener separado del importador |
| Conservar fuente y extracción | `service_request_sources`, lectura canónica y mapeo de resultados | Ampliar únicamente metadatos que falten |
| Guardar PDF privado | Bucket `customer-service-sources`, función de subida y URLs firmadas | Corregir recuperación y reutilizar |
| Extraer PDF o texto | `extract-customer-service-pdf` y funciones compartidas de Mistral | Añadir orquestación conjunta |

La lista remota de migraciones coincide con el checkout hasta
`20261020210000_customer_service_legacy_test_cleanup.sql`. Incluye esquema,
folios/plazos/coordenadas, creación, Storage, lectura, edición y aprobación.
El inventario remoto informa activas `extract-customer-service-pdf` versión 6
y `customer-service-source-pdf` versión 2. Consultar el inventario no equivale
a comparar el contenido desplegado con cada archivo local.

Borradores, técnicos del nuevo workspace y programación siguen en memoria.
Su persistencia no es una dependencia de importar requests para revisión.

## Hallazgo inicial — corregido en código, pendiente de despliegue

### P1 — un error al recibir la finalización puede eliminar un PDF confirmado

En la versión analizada inicialmente de `apps/backend/supabase/functions/customer-service-source-pdf/index.ts`,
`uploadSourcePdf` sube el objeto y llama a `finalizeUpload`. Si el RPC confirma
su transacción pero se pierde su respuesta, entra al `catch` y elimina el objeto
porque `objectWritten` es verdadero. La operación SQL de fallo rechaza entonces
degradar un archivo AVAILABLE. El resultado puede ser una fuente AVAILABLE con
un `file_id` válido cuyo objeto de Storage ya no existe.

Se reprodujo ejecutando el cuerpo de la función original con dobles en memoria.
El diagnóstico se actualizó después de corregirla y ahora verifica conservación
del objeto y reintento exitoso:

```powershell
node tmp/customer-service-email-import-audit/source-pdf-retry-probe.mjs
```

Resultado inicial: estado AVAILABLE, objeto ausente y una eliminación. Resultado
tras corregir el código: objeto conservado, cero eliminaciones y replay exitoso.
No se usó Storage
real, credenciales ni red; no es una prueba del manejador HTTP completo desplegado.
Las pruebas existentes en ese momento validaban auxiliares y RPCs por separado y no cubrían este
fallo de coordinación entre Storage y BD.

La corrección debe tratar una respuesta perdida como resultado incierto y
reconciliar el estado antes de cualquier limpieza. Para ejecución concurrente,
la propiedad del intento, la finalización y la limpieza deben estar protegidas
contra carreras; una consulta aislada previa al borrado no es suficiente.
La recuperación también debe reconocer un objeto subido cuyo proceso se
interrumpió antes de finalizar. Cualquier cambio SQL debe ser una migración nueva.
El bloque 5 evita por completo la limpieza y la sobrescritura durante la subida;
compara el objeto existente con el archivo recibido y reutiliza el RPC actual.
No requiere cambios SQL.

## Adaptaciones necesarias para correo automático

1. **Recepción persistente y creación incompleta.** El RPC manual actual exige
   Job válido, fecha, contacto e ítems. La decisión nueva requiere adaptar el
   esquema y la operación automática para guardar la request NEEDS_REVIEW aun
   cuando falten esos datos. El registro técnico de recepción conserva el correo
   y permite recuperar fallos del proceso; no sustituye la request de negocio
   incompleta que debe aparecer en la app. La aprobación mantiene sus requisitos.
2. **Identidad del mensaje y prevención de duplicados.** `submission_key` ya evita
   repetir un envío del formulario, pero una clave aleatoria por intento no
   identifica un correo. Asociar de forma única proveedor + buzón + ID estable
   del mensaje con una importación y una sola clave de envío persistida. Mantener
   el ID del hilo para contexto; no usarlo como única identidad de la request.
3. **Ejecución sin usuario conectado.** Los RPCs de captura y las Edge Functions
   actuales validan usuarios activos ADMIN/SCHEDULING. Una tarea programada no
   tiene esa sesión. Añadir una entrada interna restringida para la integración,
   con auditoría del actor de sistema y coordinación asignada conforme a una
   decisión explícita. Compartir el núcleo de validación; no desactivar la
   autorización de los endpoints humanos ni inventar un `auth.uid()`.
4. **Correo, imágenes y PDF juntos.** La migración de creación ya permite `email_text`
   cuando `source_type = PDF`; su suite comprueba esa combinación. No hace falta
   recrear `service_request_sources`. La extracción actual tiene ramas separadas
   para JSON de correo y multipart de PDF. El formulario envía el cuerpo solo
   en modo EMAIL_TEXT, y el visor muestra correo o PDF. Añadir procesamiento
   conjunto y visualización de las referencias. El alcance ampliado a imágenes
   requiere además relacionar los archivos y resultados de la fuente compuesta
   con la request; el único `file_id` PDF actual no representa todos esos archivos.
5. **Mapeo en servidor.** La resolución de Builder/Job, alias, exclusión de otros
   proveedores y mapeo al formulario viven principalmente en utilidades frontend.
   El trabajador necesita esa misma política con catálogos persistentes. Extraer
   lo reutilizable a un módulo compartido sin dependencias React y revalidar Job
   y coordenadas en BD al crear. No dejar que la IA invente IDs o ubicaciones.
6. **Origen de la fecha.** Conservar fecha del mensaje original, recepción y
   entrada a la carpeta como datos diferentes. `Reported on` mantiene la regla
   confirmada y California; mover o reenviar internamente no reinicia el plazo.
7. **Reintentos durables.** El store guarda PDFs pendientes en un `Map` del
   navegador. Eso sirve para la sesión manual, pero el importador debe recuperar
   archivos y trabajo pendiente después de reinicios, usando intentos, bloqueo
   temporal de procesamiento y reintentos persistentes.
8. **Actualización de la bandeja.** Actualmente la lectura se dispara al montar
   el provider y mediante recargas explícitas. Una request creada externamente
   necesita refresco periódico, suscripción o una acción visible de actualización.
   Conservar el token de la versión abierta en edición/revisión; no reemplazarlo
   silenciosamente por una versión nueva.

La correspondencia entre una fuente cambiada y un análisis anterior sigue siendo
un pendiente documentado. El importador debe vincular cada resultado con la
versión exacta de su entrada. El rediseño del reemplazo/reanálisis manual y sus
confirmaciones permanece pospuesto según la decisión vigente.

## Alcance propuesto del primer incremento

- Microsoft 365 / Exchange Online confirmado; un buzón y una carpeta por definir.
- Correo completo con análisis de sus imágenes y PDF, conforme a la precisión
  posterior del usuario. La capacidad actual de un PDF de hasta 10 MB corresponde
  al formulario manual. Los límites y el rechazo completo del conector ya están
  confirmados arriba; evolucionar Storage, el modelo y la extracción antes de
  activar la ampliación.
- Requests importadas incompletas guardadas como NEEDS_REVIEW y visibles para
  completar durante la revisión, conforme a la decisión del 21 de octubre.
  Adaptar la persistencia sin fabricar valores ni relajar la aprobación. Las
  entradas con adjuntos no admitidos siguen la política de rechazo completo y
  recuperación PDF/manual confirmada arriba, sin fabricar una request.
- Toda request creada automáticamente inicia NEEDS_REVIEW y conserva fuente,
  extracción y vínculo con la importación. La aprobación humana existente decide
  el paso a READY_TO_PROPOSE.
- Las respuestas posteriores y posibles duplicados de negocio se señalan para
  revisión; el primer incremento no modifica solicitudes aprobadas por interpretar
  automáticamente una cadena de correo.

El guardado estructurado incompleto y su edición están preparados en el bloque 2,
con las dos suites remotas compartidas por el usuario; la entrada automática y
el análisis compuesto siguen pendientes de implementar.
La política propuesta de respuestas posteriores sigue pendiente de confirmación.

## Secuencia de implementación propuesta

| Bloque | Entrega | Condición de salida |
| --- | --- | --- |
| 5 — Recuperación de PDF | Implementado en código; pendiente de desplegar la Edge Function | Pruebas de respuesta perdida después de commit, interrupción y concurrencia, sin eliminar un archivo confirmado |
| 6 — Registro de importaciones | Identidad de mensaje, payload, adjunto recuperable, estados operativos, intentos, vínculo y clave estable | Procesar el mismo mensaje repetidamente produce como máximo una request; lo incompleto se conserva |
| 7 — Procesamiento de contenido | Correo completo + imágenes/PDF, almacenamiento de fuente compuesta, contrato estructurado común y validación reutilizada | Cada fuente se analiza; sus datos son rastreables y editables y nunca generan aprobación automática |
| 8 — Conector del buzón | Autorización del proveedor, carpeta/etiqueta y cursor de sincronización persistente | Detectar correos movidos, recuperar interrupciones y repetir eventos sin duplicar |
| 9 — Bandeja y piloto | Refresco, acceso a fuente compuesta y recuperación de errores | Un correo real termina en revisión, se edita, se aprueba y conserva identidad al recargar |

**Orden recomendado para el prototipo, pendiente de autorización:** tras comprobar
la base vigente y los pendientes de Storage, probar el núcleo de los bloques 6/7
con correos de muestra y la revisión de la app (bloque 9). Validar primero
NEEDS_REVIEW incompleta, persistencia, recarga y aprobación humana; conectar
después Graph (bloque 8) al mismo procesador. No crear un procesador provisional
distinto que deba reemplazarse al conectar el buzón.

Para el bloque 6 se propone comenzar con una entidad de importaciones y un
registro privado de conexión/cursor. La entidad de importaciones puede actuar
como cola de trabajo mediante estados e intentos. Evaluar una cola adicional
solo si aporta una necesidad concreta. Reutilizar fuentes, archivos, contactos,
ítems y workflow existentes; no crear versiones paralelas de esas tablas. El
alcance de imágenes/PDF sí exige extender las relaciones de archivos y resultados
de fuente donde el modelo actual permite únicamente un PDF.

El envío de propuestas, rutas y calendario persistente conservan sus etapas
propias. La importación de correo puede validarse sin implementarlas primero.

## Verificación ejecutada en esta revisión

| Comprobación | Resultado |
| --- | --- |
| Frontend completo (`npm test`) | 379 aprobadas, 0 fallidas |
| Build frontend | Aprobado; advertencia existente de chunk superior a 500 kB |
| Lint frontend | Aprobado |
| Unitarias Mistral, contrato de extracción y auxiliares de Storage | 18 aprobadas, 0 fallidas; transportes simulados |
| pgTAP de esquema, folios/plazos/coordenadas, creación, Storage, lectura, edición y aprobación | 7 suites aprobadas en el proyecto vinculado, con rollback |
| pgTAP de restricciones antiguas de programación | 1 suite fallida, 1 de 14 aserciones; el antecedente está documentado en bloque 4 |
| Inventario de migraciones y Edge Functions | Consultado en el remoto, sin despliegue |
| Reproducción de respuesta de finalización perdida | Hallazgo P1 reproducido en aislamiento con dobles en memoria |

La suite antigua todavía contiene expectativas de fin de jornada a las 17:00 y
buffer de 30 minutos. Las reglas vigentes son 15:30 y sin buffer fijo global.
No modificar la operación ni ajustar expectativas aisladamente para volver verde
una suite histórica. Su reconciliación pertenece al trabajo de programación
persistente; no impide reutilizar el intake para la importación.

En la revisión inicial no se ejecutó una prueba end-to-end de correo real ni de Mistral/Storage reales,
ni una comprobación manual en navegador en esta revisión. No se aplicaron
migraciones ni se modificó código operativo durante ese diagnóstico. El seguimiento
del bloque 5 sí modifica la función de PDF local, sin desplegarla. El árbol de trabajo ya contenía
numerosos cambios previos, que se conservaron.

## Información necesaria para concretar el conector

- Proveedor confirmado: Microsoft 365 / Exchange Online.
- Buzón individual o compartido y carpeta/etiqueta que funcionará como entrada.
- Tratamiento de correos posteriores relativos a una request existente; el
  guardado incompleto en NEEDS_REVIEW ya está confirmado.
- Manejo operativo de fuentes ilegibles y fallos de infraestructura; los formatos,
  límites y recuperación PDF/manual ya están confirmados y falta implementarlos.
- Responsable operativo de las requests creadas por la integración y tratamiento
  deseado del mensaje después de importarlo.

Abrir el correo con Outlook no demuestra que el proveedor sea Microsoft 365.
La disponibilidad de un conector de correo en el entorno de esta conversación
tampoco identifica por sí sola el buzón que el producto debe integrar.
