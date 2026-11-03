# Customer Service — reglas vigentes del proyecto

Última consolidación: **2 de noviembre de 2026**.

## 1. Propósito y uso

Este documento conserva las decisiones de la conversación sobre Customer Service
de Valtrim. Es la referencia de reglas funcionales para diseñar, implementar y
probar el módulo; no es una certificación de que todas estén implementadas.

- Las decisiones posteriores del usuario sustituyen acuerdos anteriores sobre
  el mismo punto. Actualizar este documento cuando se apruebe un cambio.
- No convertir una sugerencia, un ejemplo del correo o un dato mock en una regla
  definitiva. Lo no decidido se mantiene en **Decisiones abiertas**.
- La especificación técnica y el plan por etapas complementan estas reglas. Si
  contienen una regla anterior incompatible, prevalece la decisión vigente aquí
  documentada. Si falta una decisión, consultar antes de ampliar el alcance.
- Mantener el flujo simple: reutilizar vistas y componentes existentes; no
  añadir estados, pantallas o automatismos sin una necesidad acordada.

Referencia complementaria: [Especificación y etapas](customer-service-request-scheduling-spec.md).

## 2. Alcance de la etapa actual

- Primero definir y validar **frontend**: vistas, componentes, navegación,
  formularios, estados y simulación del proceso.
- **Bloque 1 verificado contra Supabase el 20 de octubre de 2026:** el provider carga exclusivamente
  requests reales de Supabase, incluida su fuente/extracción. Crear guarda la
  request y el PDF opcional y vuelve a leer el registro canónico del servidor;
  recargar conserva folio y contenido persistidos. No se mezclan requests fixture
  con solicitudes reales. La lectura Builder → Job → coordenadas sigue usando
  los providers existentes.
- **Bloque 2 desplegado, confirmado el 20 de octubre de 2026
  (`20261020170000_customer_service_intake_update.sql`):** edición transaccional de
  la misma request, validada por ADMIN/SCHEDULING activos. Conserva identidad,
  fuente, PDF y extracción, registra auditoría y usa la versión exacta abierta
  por la coordinadora para rechazar sobrescrituras de otra edición. El servidor
  devuelve la representación canónica; el formulario espera la respuesta y
  conserva la captura abierta ante errores. Recargar conserva
  también las ediciones.
- **Bloque 3 desplegado, confirmado el 20 de octubre de 2026
  (`20261020190000_customer_service_request_ready.sql`):** Mark ready to propose es
  una operación transaccional independiente para ADMIN/SCHEDULING activos.
  Revalida información completa y confirmación explícita de Valtrim, compara la
  versión revisada y guarda estado, revisor autenticado, hora del servidor,
  historial y auditoría. El frontend espera la representación canónica y muestra
  errores sin aprobar localmente. La aprobación se conserva al recargar.
  Ver [pruebas del bloque 3](customer-service-block-3-testing.md).
- **Bloque 4 — limpieza aplicada el 20 de octubre de 2026:** se eliminaron
  exclusivamente las requests ID 3 (`SR-00001003`) y 4 (`SR-00001004`), sus dos
  propiedades no compartidas y dependencias históricas de prueba verificadas.
  El usuario autorizó expresamente ejecutar la eliminación **sin respaldos**;
  no se crearon exportaciones ni copias recuperables. Se conservó la auditoría
  global y se añadieron dos eventos de limpieza con IDs/conteos, no contenido.
  La migración `20261020210000_customer_service_legacy_test_cleanup.sql` comprobó
  versiones exactas, exclusividad y hashes transitorios de registros ajenos.
  No se tocaron las requests 55/64, sus fuentes, Storage, Builders ni Jobs.
  La regresión completa detectó fallos preexistentes que se documentan aparte;
  la limpieza no implica una certificación de toda la suite en verde.
  Ver [resultado del bloque 4](customer-service-block-4-testing.md).
- Solo borradores y programación siguen en memoria. Aprobar no crea propuesta,
  cita ni reserva y no envía correos. No ampliar este bloque a SMTP o rutas.
- **Limpieza de columnas aprobada el 21 de octubre de 2026, pendiente de aplicar:**
  retirar exclusivamente `request_type`, `work_type`, `status`, `tag` y
  `status_note` de `service_requests`, junto con sus RPC y vistas del contrato
  anterior. `workflow_stage` y `work_category` son las referencias vigentes.
  Conservar contactos, ítems, fuentes, seguimiento del cliente, metadatos de
  cierre y los historiales existentes; dejar de generar el historial de estados
  antiguos. La migración debe abortar si encuentra clasificaciones, notas o
  estados anteriores que necesiten una correspondencia no acordada. No integra
  programación ni define cancelación/cierre. Las solicitudes con `closed_at`
  siguen bloqueadas en edición y aprobación. No editar migraciones aplicadas.
- La extracción IA mediante Mistral ya integrada permite llenar el formulario
  manual, pero esa operación no guarda ni aprueba la request. La importación
  automática desde correo descrita abajo es un alcance confirmado pendiente de
  implementación: su procesador guardará la request como NEEDS_REVIEW y mantendrá
  la aprobación humana independiente.
- Identificar los datos simulados y las dependencias externas. No presentar
  disponibilidad simulada como comprobación real de todos los trabajos de Valtrim.
- Las reglas del proceso también se aplican a los mocks: la simulación no
  justifica estados incorrectos ni permite saltarse una revisión.
- La disponibilidad de Proposal Workspace contempla **solo Customer Service**,
  no los trabajos del módulo Production. Decisión confirmada el 13 de octubre de 2026.
- **Recuperación de PDF preparada en código el 20 de octubre de 2026:** los
  reintentos conservan el objeto, verifican tamaño/SHA-256 cuando ya existe y
  reutilizan el finalizador idempotente. La corrección no está desplegada ni
  requiere migración; ver [bloque 5](customer-service-block-5-testing.md).

## 3. Responsabilidades y flujo

Anelda Calvillo coordina Customer Service. Valtrim decide las opciones de cita
considerando disponibilidad y conveniencia de los traslados; el cliente responde
a una propuesta, no agenda libremente sobre el calendario completo.

1. Recibir el correo del builder y crear **New Request**, mediante extracción o
   captura manual. Guardar la solicitud como `NEEDS_REVIEW`.
2. En **Review Request**, completar y revisar esa misma solicitud, confirmar el
   alcance de Valtrim y usar **Mark ready to propose**.
3. En **Proposal Workspace**, consultar la request aprobada y preparar técnico,
   día, ventana del cliente y horario interno del trabajo.
4. En **Proposal Preview & Send**, revisar destinatario, asunto, contenido y
   ventana, confirmar el envío y pasar a `AWAITING_CUSTOMER` cuando se envíe.
5. El cliente acepta o rechaza desde una vista pública. Si acepta, la cita queda
   `CONFIRMED`, aparece en Calendar y la vista confirma que fue registrada. La
   página ofrece **Necesito que me contacten** en lugar de mostrar un teléfono;
   esa acción pasa a `NEEDS_CONTACT` para que Anelda llame y acuerde la cita. Si
   rechaza, registra los días en que está disponible; Valtrim prepara otra
   propuesta y Anelda la revisa antes de enviarla.
6. Si se necesita aclarar algo con el cliente, dar seguimiento como
   `NEEDS_CONTACT`. La fecha alternativa no se confirma automáticamente.
7. Después de aceptar, mantener la request confirmada y pendiente por realizar;
   al comenzar su ventana pasar automáticamente a `WORKING` y, al finalizar esa
   ventana, pasar automáticamente a `COMPLETED`.
   No crear visitas adicionales.

Preparar o guardar un borrador **no** equivale a enviar una propuesta, confirmar
una cita ni crear otra request. El folio identifica la misma solicitud durante
todo el proceso. La persistencia usará el prefijo `CS-`, igual que el prototipo
actual. La migración nueva deberá sustituir el prefijo `SR-` que todavía genera
la base de datos, sin modificar las migraciones remotas ya aplicadas. Decisión
confirmada el 19 de octubre de 2026.

**Importación desde correo — flujo confirmado el 20 de octubre de 2026:** mover
el mensaje a la carpeta elegida de Microsoft 365 dispara el análisis del correo
completo. Si contiene imágenes o PDF, también se analizan junto con el mensaje.
El procesador reúne la información y registra la request en base de datos como
`NEEDS_REVIEW`. Una persona abre esa misma request, compara las fuentes, corrige
los campos y da el visto bueno mediante **Mark ready to propose**, que la pasa a
`READY_TO_PROPOSE` cuando cumple los requisitos. La IA no aprueba la request.
Este acuerdo define el resultado esperado. El análisis compuesto está preparado
localmente en el bloque 4 de importación; el conector y su ejecución automática
siguen pendientes. No equivale a un flujo automático activo.

**Datos incompletos en la importación — decisión del 21 de octubre de 2026:**
si faltan datos extraídos, registrar igualmente la request como `NEEDS_REVIEW`
y mostrar los pendientes para que una persona los complete y revise. La falta
de Job, contacto u otros datos de captura no debe dejar el correo únicamente en
una bandeja técnica sin request. No inventar valores para llenar lo ausente ni
presentar valores inválidos como válidos. Antes de pasar a `READY_TO_PROPOSE`,
exigir la información completa y la aprobación humana vigente. El bloque 2 de
importación implementa el guardado estructurado parcial mediante un RPC exclusivo
del backend; no equivale a tener activo el conector ni el análisis del correo.

**Precisión del mínimo y recuperación de importaciones:** para crear la request
importada se requieren nombre del propietario y al menos un ítem con descripción;
los demás faltantes se completan en NEEDS_REVIEW sin relajar la aprobación. Si el
análisis falla o no obtiene ese mínimo, conservar el correo como importación con
problemas, sin inventar propietario ni ítems. Mostrar esos problemas mediante un
contador/panel dentro de **Requests**, con acceso al original y recuperación por
reintento o captura manual en el formulario existente. No crear otra página de
gestión de correos ni agregar un estado de error al workflow de la request. Un
problema también puede quedar asociado a una request ya creada parcialmente.

**Importación por correo, bloque 1 autorizado el 22 de octubre de 2026:** registro
técnico independiente con identidad estable de tenant/buzón/mensaje, fuente,
referencias de adjuntos, extracción, intentos, errores y vínculo opcional a la
request. Sus estados son PENDING, PROCESSING, NEEDS_ATTENTION y PROCESSED; este
último no equivale a aprobación humana. Repetir el mismo mensaje conserva el
registro, su clave de envío y la request vinculada. El bloque se prepara solo en
archivos locales; el usuario aplicó la migración y la suite del registro más las
cuatro regresiones de creación/lectura/edición/aprobación pasaron en el remoto.
No incluye todavía conector, procesador, subida de adjuntos ni panel UI.

**Importación por correo, bloque 2 autorizado el 22 de octubre de 2026:** preparar
el guardado automático desde una importación registrada y la revisión incremental
en el formulario existente. `save_customer_service_imported_request` será exclusivo
del backend, sin suplantar una sesión humana ni asignar coordinador por defecto.
Creación y vínculo se guardan juntos; los reintentos devuelven la request existente
sin sobrescribir cambios humanos ni restaurar una aprobación anterior.
Las fechas ausentes permanecen ausentes, sin vencimiento calculado hasta revisar
Reported on. Los contactos importados pueden conservar información parcial en
NEEDS_REVIEW. Valores proporcionados inválidos no se aceptan como correctos: un
guardado automático fallido queda en NEEDS_ATTENTION, sin request ficticia ni filas
parciales. La captura manual, las restricciones posteriores a la revisión y los
requisitos completos de aprobación permanecen vigentes. La migración
`20261022140000_customer_service_imported_request_intake.sql` fue aplicada por el
usuario. El 22 de octubre compartió PASS de
`customer_service_imported_request_intake.test.sql` y
`customer_service_request_intake_schema.test.sql`: dos suites, cero fallidas.
Esto no certifica toda la regresión ni una integración de Outlook, IA o archivos.

**Adjuntos y recuperación de correo — decisión del 22 de octubre de 2026,
con activación e integración UI pendientes:** admitir PDF, JPG/JPEG y PNG; máximo **10 MB por
archivo**, **10 archivos por correo**, incluidas imágenes inline, y **50 MB en
total de adjuntos por correo**. Validar el conjunto completo antes de persistir
archivos o crear la request. Si algún archivo incumple el contrato, detener la
importación automática de ese correo: no crear request ni guardar adjuntos
parcialmente. Conservar un registro técnico mínimo con identidad estable,
estado NEEDS_ATTENTION, motivo del rechazo y enlace al correo original. Ese
registro permite mostrarlo y recuperar el mismo correo sin duplicados; no es un
estado nuevo del workflow de la request.

Mostrar el caso en **Correos con problemas**, dentro de Requests, y permitir
abrir el formulario existente para subir un PDF válido y extraer sus datos de
forma semiautomática. Si esa extracción tampoco funciona, permitir captura
manual. La request se crea al guardar, queda vinculada a la misma importación
y en NEEDS_REVIEW; sigue requiriendo aprobación humana para READY_TO_PROPOSE.
El rechazo de adjuntos es distinto de la extracción válida con campos de negocio
faltantes: esta última conserva el mínimo de propietario y un ítem descrito.
El almacenamiento/validación corresponde al bloque 3; el panel y la recuperación
en el formulario requieren su integración UI posterior.

**Importación por correo, bloque 3 autorizado y verificado el 22 de octubre de
2026:** `20261022160000_customer_service_import_source_storage.sql` prepara
un bucket privado distinto del PDF manual, manifiesto original inmutable y
relación de archivos con la importación antes de existir la request. El módulo
del servidor valida todo el conjunto —extensión, MIME, firma, tamaño real,
cantidad e identidad— antes de subir archivos; calcula SHA-256 y usa rutas
deterministas sin reemplazar objetos. Los límites automáticos usan MB decimales:
10,000,000 bytes por archivo y 50,000,000 por correo; el PDF manual existente
conserva sus 10 MiB y su contrato separado.

Un rechazo de validación conserva solo metadatos técnicos/motivo/enlace, sin
cuerpo, request ni archivos del correo rechazado. Un fallo de infraestructura
durante una carga ya validada es distinto: puede dejar objetos privados en
preparación, sin archivos publicados ni request. Reintentar el mismo manifiesto
recupera esos objetos; no se borran objetos que otro finalizador pudo confirmar.
Todas las referencias/filas de archivos se publican juntas en una transacción
SQL; no se afirma atomicidad entre SQL y Storage. El guardado del bloque 2 exige
fuente AVAILABLE; el replay de requests anteriores sigue funcionando sin
certificar archivos históricos ausentes. Los originales tienen lectura mediante
una nueva Edge Function autenticada con URLs temporales para ADMIN/SCHEDULING
activos. El usuario aplicó la migración y desplegó la función. Se verificaron
su presencia remota, función ACTIVE v1 con JWT, rechazo sin autenticación,
preflight y ocho suites SQL relacionadas aprobadas con ROLLBACK. No se probó
todavía la transferencia binaria real ni se activaron Graph o Correos con
problemas. Ver
[validación y activación del bloque 3 de correo](customer-service-email-import-block-3-testing.md).

**Importación por correo, bloque 4 autorizado el 22 de octubre de 2026, preparado
localmente:** analizar el cuerpo completo normalizado, PDF mediante OCR, imágenes
mediante visión y valores de formularios PDF mediante lectura separada. El HTML
se trata como texto inerte, sin ejecutar scripts ni descargar recursos remotos;
las partes largas se dividen sin truncar. Los originales no se modifican.

Conservar hechos y procedencia por fuente, páginas OCR, valores del formulario,
advertencias y alternativas contradictorias, separados de las correcciones
humanas. No deducir propietario del remitente ni inventar teléfonos, ubicación,
trabajos o aprobación. Una coincidencia activa única del catálogo permite
proponer Job y sus coordenadas verificadas; la ambigüedad queda pendiente. Los
ítems explícitamente asignados a otro proveedor se conservan como evidencia,
pero no se incorporan automáticamente a la request.

Si todas las fuentes se leen y existe propietario más un ítem descrito, producir
una propuesta compatible con el guardado parcial del bloque 2. Los demás datos
faltantes o contradictorios quedan pendientes, no se rellenan artificialmente.
`READY_FOR_INTAKE` es un resultado técnico, no READY_TO_PROPOSE ni aprobación.
Una fuente fallida o la falta del mínimo produce NEEDS_ATTENTION sin propuesta
de guardado. Las fuentes válidas ya retenidas en el bloque 3 permanecen; no se
confunde este caso con un rechazo de formato anterior a la subida.

La migración nueva `20261022180000_customer_service_import_analysis.sql` conserva
el análisis en `analysis_payload`, separado del payload de guardado; lo protege
contra sustitución después de vincular una request. El usuario la aplicó; se
verificaron el historial remoto y nueve suites SQL relacionadas, todas PASS con
ROLLBACK, antes de iniciar el bloque 5. Este bloque no añade una
Edge Function pública, worker, lectura de Outlook ni panel UI; tampoco crea
requests ni llama a la aprobación. Ver
[pruebas y activación del bloque 4 de correo](customer-service-email-import-block-4-testing.md).

**Importación por correo, bloque 5 autorizado el 22 de octubre de 2026, preparado
localmente:** un worker del servidor conecta el registro/fuentes, análisis y
guardado parcial existentes. Solo toma fuentes AVAILABLE sin request, con reserva
temporal y token por ejecución. Un proceso vencido no puede sustituir avances,
análisis ni el resultado del proceso que lo reemplaza. Una request ya vinculada
se devuelve sin repetir inferencia, editarla ni aprobarla.

Cada invocación trabaja un correo. Los avances por fuente y errores sanitizados
se conservan en BD; solo se reutilizan fuentes analizadas correctamente y de la
misma identidad original. Al ceder por presupuesto de tiempo, queda PENDING para
la siguiente invocación sin consumir el presupuesto de fallos. Al terminar un
análisis válido, el guardado existente crea/vincula una sola NEEDS_REVIEW; solo
una respuesta con request confirmada cuenta como PROCESSED.

Los fallos temporales tienen reintentos durables limitados; faltantes mínimos,
rechazos y fallos permanentes quedan NEEDS_ATTENTION sin request automática. Los
valores operativos iniciales son reserva de tres minutos, tres fallos como máximo
y esperas de uno/cinco minutos. No son requisitos nuevos del formulario. El
worker no rellena datos ausentes, no cambia fuentes ni permite aprobación IA.

La migración nueva `20261022200000_customer_service_email_worker.sql` y la función
`customer-service-email-worker` quedan pendientes de aplicar/desplegar por el
usuario. La función requiere secreto exclusivo del servidor y está deshabilitada
por defecto. No se instala cron ni se activa ejecución periódica, Graph o UI en
este bloque: los trabajos pendientes se retoman en invocaciones posteriores.
Ver [pruebas y activación del bloque 5 de correo](customer-service-email-import-block-5-testing.md).

**Importación por correo, bloque 6 — primera parte autorizada el 23 de octubre
de 2026:** añadir contador y panel de consulta dentro de Requests, reutilizando
los RPC existentes de conteo, listado paginado y detalle. Contar únicamente
NEEDS_ATTENTION, no requests NEEDS_REVIEW ni importaciones PENDING/PROCESSING.
Mostrar asunto, remitente, motivo, fechas en California y request vinculada
cuando existan. El detalle se consulta al seleccionarlo y permite abrir el
webLink HTTPS del original cuando está disponible; no inventar enlaces ni
archivos para las muestras sin correo real. Diferenciar carga, error de lectura
y vacío real, con actualización manual. No cargar cuerpos/extracciones para
construir el listado ni mezclar sus fallos con la bandeja de requests.
Esta primera parte es de solo lectura para los actores ADMIN/SCHEDULING activos
ya autorizados. No requiere migración nueva ni invoca el worker desde el
navegador. Reintentos, recuperación con PDF/formulario, consulta de adjuntos y
automatización/Graph permanecen pendientes; no considerar cerrado todo el bloque 6.

**Importación por correo, bloque 6 — reintento y recuperación autorizados el 23
de octubre de 2026, preparados localmente:** añadir acciones al mismo panel.
El reintento exige sesión ADMIN/SCHEDULING activa, confirmación y fuente original
AVAILABLE sin request vinculada. Una Edge Function autenticada utiliza el worker
del servidor; nunca expone su secreto al navegador. Respeta la bandera operativa,
reservas, versiones, avances y esperas existentes. Si una ejecución manual cede
por presupuesto o espera, conserva sus avances y deja visible la continuación
en NEEDS_ATTENTION, sin reiniciar el presupuesto de fallos ni depender de cron.
Este tratamiento es exclusivo del reintento humano; el worker automático mantiene
su contrato PENDING/backoff.

Recuperar abre el formulario existente vinculado al importId, con PDF opcional o
captura manual. Exige propietario y un ítem descrito; los faltantes siguen en
NEEDS_REVIEW. No asigna una fecha fuente por defecto ni relaja el alta manual
normal o la aprobación. El RPC crea/vincula la request en una transacción, con
actor autenticado, versión y auditoría; si otro proceso ya la creó, devuelve la
misma sin aplicar los campos obsoletos ni cambiar su revisión. La excepción humana
al guardado de fuentes rechazadas no permite al importador automático saltarse
AVAILABLE ni transforma el original rechazado en un adjunto aceptado.

El PDF de recuperación se conserva como fuente separada, mediante el contrato
manual privado de un PDF de 10 MiB. Su SHA-256, tamaño y nombre quedan fijados
al crear la request y se verifican antes de subir/finalizar, para que un segundo
operador no pueda asociar otro PDF a los datos del ganador. Si su carga falla después del guardado,
conservar request/folio y el problema RECOVERY_PDF_PENDING; completar el mismo
archivo sin reemplazos ni duplicados. El panel permite retomar esa carga tras
recargar, y finalizar sin otra subida cuando el PDF ya está AVAILABLE. Si ya hay
otra request vinculada, abrir su revisión existente. Conservar correo, manifiesto
y análisis originales y la auditoría del motivo anterior. Recuperar o completar
archivos no aprueba una request ni cambia una aprobación humana posterior.
La migración `20261023160000_customer_service_email_recovery.sql` y el despliegue
de `customer-service-email-retry` y `customer-service-source-pdf` quedan pendientes del usuario. Ver
[activación del bloque 6](customer-service-email-import-block-6-testing.md).
Graph, ejecución periódica y visor de adjuntos originales siguen fuera de esta entrega.

**Actualización del bloque 6, verificada el 23 de octubre de 2026:** el usuario
confirmó su cierre. Se comprobó remotamente la migración `20261023160000`, las
funciones de reintento v1 y PDF v6 ACTIVE con JWT, preflight 200 y rechazo 401 sin
sesión. Nueve suites SQL relacionadas pasaron con ROLLBACK, más 27 pruebas locales
de reintento/PDF y 436 frontend. Esa comprobación no repitió el flujo visual con
un PDF real ni la extracción IA; no certifica por sí sola el piloto completo.

**Importación por correo, bloque 7.3 autorizado el 23 de octubre de 2026:**
preparar exclusivamente configuración privada y estado de sincronización, sin
pantalla nueva, endpoint público, lectura de Microsoft, cambios en el buzón ni
ejecución periódica. El usuario indicó que usará su propio buzón para pruebas,
que ya creó la carpeta y que preparó el acceso de Microsoft. No se verificaron
esas credenciales en esta entrega. El diseño propuesto sigue siendo app-only;
no requiere callback de autorización. No asumir acceso delegado por existir una
configuración de URI en el portal.

La conexión conserva tenant, UUID de objeto del buzón e ID de carpeta, con
identidad inmutable y deshabilitada por defecto. No crear una conexión real con
valores supuestos ni almacenar secretos, access/refresh tokens o cuerpos en esa
tabla. Las credenciales de aplicación permanecen en los secretos del servidor.
No elegir automáticamente si se importa el contenido anterior: permitir dejar
esa decisión pendiente y exigir IMPORT_EXISTING o BASELINE_ONLY antes de
habilitar. Una vez iniciada la sincronización no cambiar silenciosamente ese
modo ni reiniciar el cursor.

Solo el contexto de sistema y sus RPC pueden acceder a la configuración, incluso
si la persona en la app es ADMIN/SCHEDULING. Cada ejecución tiene reserva temporal,
token y revisión exacta para que otra ejecución o una página atrasada no pueda
sobrescribir el avance. Deshabilitar revoca la reserva, no borra progreso ni
requests. Conservar completos los nextLink/deltaLink y validarlos contra el
origen Graph y el buzón/carpeta configurados; no registrar URLs en auditorías o
errores visibles. Antes de avanzar, el futuro conector debe entregar todos los
mensajes no eliminados de la página, retenidos con fuente o problema técnico
durable. El RPC verifica que los importIds existan y correspondan al mismo
tenant/buzón; no puede comprobar por sí solo que el conector no omitió mensajes
de la respuesta de Microsoft. La línea base inicial explícita no importa
históricos. Solo un deltaLink confirma una ronda completa; una pausa o fallo no
inventa éxito. Guardar diagnósticos con códigos conocidos y mensajes fijos,
nunca errores crudos con credenciales. El vencimiento de un cursor requiere
reconciliación posterior controlada; este bloque no lo descarta automáticamente.

La migración `20261023180000_customer_service_email_connection_state.sql`, sus
pruebas y el adaptador backend quedan preparados para instalación por el usuario.
El conector HTTP, la autorización real al buzón y su programación corresponden
a las siguientes entregas. Ver [pruebas del bloque 7.3](customer-service-email-import-block-7-3-testing.md).

**Configuración del piloto — actualización del 27 de octubre de 2026:** el usuario
confirmó `victor@valtriminc.com`, su carpeta raíz `Customer Service` y la política
`BASELINE_ONLY`: no importar el contenido histórico de la primera ronda; importar
las entradas posteriores a completar la inicialización. Registrar la conexión no
inicia esa ronda ni establece por sí solo el corte. La conexión debe permanecer
deshabilitada hasta la activación posterior autorizada del conector.

Tenant, client ID y secreto de aplicación se guardaron y verificaron en Supabase
Secrets el 26 de octubre; no pertenecen al registro privado ni al frontend. El 27
de octubre se comprobó autenticación app-only y lectura de metadatos de la carpeta,
sin consultar mensajes. La consulta del perfil del usuario devolvió HTTP 403 y no
se obtuvo el UUID canónico del buzón. No existe una conexión para esa carpeta y
su registro real queda pendiente de ese UUID; el Object ID de la aplicación no lo
sustituye. No se ampliaron permisos ni se activó sincronización. Pasaron las 11
pruebas del adaptador y la suite SQL remota de conexiones con ROLLBACK.

**Registro de la conexión completado el 27 de octubre de 2026:** el usuario
proporcionó el UUID `ec1afdfd-199f-4fd4-98e7-069fb4dd909e`. Se verificó mediante
lectura de metadatos que ese UUID y `victor@valtriminc.com` acceden a la misma
carpeta `Customer Service` y al mismo padre. Se registró mediante el RPC existente
la conexión `779ebb10-fc40-4a30-9a72-639123cbb057`, con `BASELINE_ONLY` y
`enabled=false`. La relectura independiente confirmó una sola conexión, revisión
1, cero intentos/importaciones del buzón y ausencia de cursor, reserva e
inicialización. Un replay conservó el mismo ID y revisión. No se activó la
conexión ni se consultaron cuerpos/adjuntos, invocó IA o crearon requests.
Esto resuelve el UUID y registro pendientes descritos en la comprobación anterior.

**Conector Graph — punto 4 / bloque 7.4 autorizado el 27 de octubre de 2026:**
implementar código y pruebas simuladas sin depender de una sesión personal de
Microsoft ni registrar una conexión con UUID supuesto. El endpoint de servidor
`customer-service-email-sync` requiere secreto propio, activación global explícita
y una conexión privada habilitada. Cada invocación recibe solo `connectionId`,
consulta una página delta de la carpeta configurada y libera su reserva al parar.
Usa autenticación app-only con los secretos existentes; no permite al cliente
proporcionar tenant, carpeta, credenciales, URLs ni modo de sincronización.

Conservar IDs inmutables sensibles a mayúsculas. Enumerar todos los adjuntos,
incluidas imágenes inline aunque `hasAttachments` sea falso; validar el conjunto
completo y reutilizar los límites, firma, hash y almacenamiento privados del
bloque 3. Un rechazo conserva únicamente el problema técnico y metadatos originales.
Las fuentes completas AVAILABLE se entregan a la cola durable del worker del
bloque 5; el conector no hace inferencia, crea requests ni aprueba. El worker debe
ejecutarse aparte y mantiene el contrato NEEDS_REVIEW y revisión humana existente.

BASELINE_ONLY omite la lectura del cuerpo, adjuntos y registro de mensajes
históricos hasta el primer DELTA. Conserva únicamente sus IDs en una tabla privada,
en la misma transacción del cursor, para que un cambio de leído/no leído no los
importe después. Se solicita changeType=created, pero se filtran también los IDs
históricos porque Microsoft puede devolver eventos de lectura pese a ese filtro.
Una salida observada libera solo esa pertenencia histórica; una entrada posterior
puede recibirse sin borrar ninguna request. No filtrar las entradas por fecha
de envío. Los cambios repetidos reutilizan la importación/fuente/request y las
eliminaciones de Graph no borran solicitudes. Antes de avanzar cada página deben
estar retenidos todos sus mensajes no eliminados o sus problemas durables, salvo
los IDs históricos excluidos. Una
entrega parcial conserva el cursor anterior; una respuesta de checkpoint perdida
queda sin confirmar hasta releer, sin adivinar una revisión.

No seguir redirecciones ni enlaces de documentos/imágenes externas; validar cada
continuación contra Graph, buzón y carpeta. Cuerpos/archivos fallidos no se recortan
para aparentar éxito. El límite técnico JSON de transporte es 16 MiB por respuesta:
una fuente que lo exceda queda para recuperación manual; una página delta inválida
no avanza. Los límites de adjuntos de negocio permanecen en 10/10/50 MB decimales.
Conservar Retry-After con hora del servidor y bloquear reclamos tempranos. Un cursor
vencido exige reconciliación controlada; no reiniciarlo automáticamente. No guardar
errores crudos de Microsoft, tokens ni URLs de continuación en respuestas visibles.

La migración nueva `20261027190000_customer_service_graph_retry.sql` prepara espera
durable, IDs privados de línea base y bloqueo por cursor vencido. La comprobación
remota posterior confirmó migración aplicada, RPC/tabla/columna presentes y
endpoint ACTIVE v1 con arranque correcto. La conexión ya está registrada como se
describe arriba. `CUSTOMER_SERVICE_EMAIL_SYNC_SECRET` se generó y guardó en
Supabase Secrets el 27 de octubre: 48 bytes aleatorios criptográficos codificados
en base64url (64 caracteres), coincidencia verificada mediante metadatos. Su valor
se entregó al usuario a petición expresa y no se guardó en archivos del repositorio.
La conexión sigue deshabilitada, con cero intentos y sin inicializar; el interruptor
global sigue ausente. Falta preparar y autorizar el piloto antes de habilitarla.
No se consultaron cuerpos/adjuntos reales, consumió IA ni activó cron durante
estas tareas de implementación y configuración.
Ver [pruebas del conector](customer-service-email-import-block-7-4-testing.md).

**Corrección y línea base real verificadas el 27 de octubre de 2026:** con ambos
controles habilitados por el usuario, el primer intento falló con SYNC_ERROR:
Microsoft devolvió `mailFolders('ID')` y se exigía `/mailFolders/ID`. Se corrigieron
el validador backend, la comprobación previa a HTTP y el validador SQL para aceptar
ambas formas. Se compara el UUID exacto de buzón y el ID case-sensitive de carpeta,
decodificando cada segmento una sola vez y las comillas duplicadas del literal
OData. Se conserva intacta la URL completa, sus tokens y los controles de host,
credenciales, fragmentos, ámbito, tipo y unicidad del token. No se siguen redirects.

Se aplicó la migración nueva `20261027200000_customer_service_graph_odata_folder_keys.sql`
tras revisar historial, dry-run y pruebas; no se editaron migraciones aplicadas.
El conector corregido quedó ACTIVE v4. Pasaron 58 pruebas locales y tres suites
SQL con la migración en preview y después instalada. El reintento real devolvió
ROUND_COMPLETE: conexión inicializada, cursor DELTA con sintaxis OData conservado,
último error nulo y reserva liberada. La ronda inicial no encontró mensajes y
conservó cero importaciones y cero requests del buzón. No se invocó el worker ni
IA, ni se activó ejecución periódica. Los controles existentes quedan habilitados;
la siguiente entrada real y el piloto de extracción/revisión siguen pendientes.

**Corrección de tamaños Graph — bloque 1 autorizado y verificado el 27 de octubre
de 2026:** el piloto posterior registró una importación NEEDS_ATTENTION con
ATTACHMENT_SIZE porque se exigía igualdad entre `attachment.size` de Graph y los
bytes crudos de `/$value`. El correo contenía siete imágenes, cuatro inline, sin
PDF. Sus siete tamaños informados diferían de los descargados.

La corrección conserva los límites confirmados: 10 MB decimales por archivo,
10 adjuntos incluyendo inline y 50 MB totales. Se aplican a los bytes reales
durante la descarga, con cancelación al superar el presupuesto por archivo o
conjunto. El tamaño de metadatos Graph debe ser un entero seguro no negativo,
pero no determina el límite de negocio ni se pasa como `declaredSize` del archivo
crudo. Se conserva la validación compartida de tamaño, firma y SHA-256 antes de
fijar fuentes o subir cualquier archivo. El contrato `declaredSize` de los otros
productores no cambia.

Rechazar descargas vacías, parciales o con Content-Range. Comprobar Content-Length
cuando esté disponible y describa el cuerpo sin codificación de contenido; no
comparar el tamaño de transporte comprimido con bytes descomprimidos por fetch.
Sin Content-Length se exige terminar la lectura completa y se mantienen límites
y firma. Una interrupción del stream sigue siendo un fallo temporal de Graph;
no publicar el contenido parcial.

Pasaron 108 pruebas locales (55 del conector y 53 de adjuntos/almacenamiento),
tipos del endpoint y lint. Se desplegó `customer-service-email-sync` ACTIVE v5 y
se verificó arranque mediante GET 405. La validación real del mismo correo, en
solo lectura y memoria, aceptó los siete adjuntos con 8.901.705 bytes totales.
No guardó fuentes, ejecutó IA ni creó requests. No hay migración para esta
corrección. Al cerrar ese bloque, la importación original permanecía
REJECTED/NEEDS_ATTENTION, sin request; su recuperación correspondía al bloque 2.

**Recuperación Graph — bloque 2 autorizado y cerrado el 27 de octubre de 2026:**
añadir una operación explícita de servidor al endpoint de sincronización,
protegida por su secreto y bandera existentes. No cambiar el reintento humano del
bloque 6 ni reabrir todos los rechazos automáticamente. Recibir connectionId,
importId y versión exacta updated_at; nunca tenant, buzón, carpeta, credenciales,
fuentes o archivos proporcionados por el llamador. Exigir conexión inicializada,
reserva vigente, revisión y pertenencia exacta al tenant/buzón configurados.

Esta corrección solo reabre rechazos ATTACHMENT_SIZE/ATTACHMENT_TOTAL_SIZE sin
fuente fijada, archivos publicados, extracción, reserva de worker ni request.
Primero volver a leer el mensaje dentro de la carpeta configurada y validar todo
su cuerpo y conjunto de archivos con el código corregido. Si incumple los límites
o formato, mantener el rechazo y no guardar fuentes parciales. La transacción SQL
reabre y fija el conjunto completo de manera atómica y audita, como SYSTEM, el
error anterior, su mensaje, versión y corrección GRAPH_RAW_ATTACHMENT_SIZE. No
reiniciar contadores de extracción ni el cursor delta o la línea base.

Repetir una fuente aceptada o vinculada no la reemplaza ni modifica la request.
Un fallo después de fijar la fuente conserva el manifiesto inmutable y permite
continuar solo la misma recuperación auditada: no sustituir cuerpo, nombres,
archivos o hashes. La recuperación mantiene los límites y permisos vigentes.
Al subir un Blob/File, normalizar su MIME al tipo validado del manifiesto sin
modificar bytes ni el File original: el SDK multipart utiliza el MIME del archivo
aunque se haya indicado contentType en sus opciones. Los MIME genéricos/vacíos de
Graph no deben provocar un rechazo de Storage para un contenido ya validado.

Se aplicó únicamente la migración nueva
`20261027210000_customer_service_graph_source_recovery.sql`, tras historial,
dry-run y ensayo con ROLLBACK; no se editaron migraciones aplicadas. Pasaron
126 pruebas locales (67 conector/recuperación y 59 adjuntos/almacenamiento), tipos,
lint y cuatro suites SQL antes y después de instalar. El conector quedó ACTIVE
v7. La recuperación real del importId `70288f7b-6169-4963-af47-3f1df7cc967a`
devolvió SOURCE_RECOVERED. Lecturas independientes confirmaron AVAILABLE/PENDING,
7 objetos privados y 7 vínculos de archivo, 8.901.705 bytes, un único registro y
una auditoría con el error original, sin cambiar el cursor y sin reserva pendiente.
No se ejecutó worker ni IA: request_id y extracción siguen nulos, attempt_count
sigue en cero. Al cerrar el bloque 2, el bloque 3 quedó pendiente por indicación
del usuario.

**Piloto real — bloque 3 autorizado el 28 de octubre de 2026:** procesar únicamente
el importId recuperado y comprobar guardado, originales, duplicados y revisión.
El usuario autorizó generar/configurar un nuevo secreto del worker. Se guardó en
Supabase Secrets, se verificó su huella y se conservó una copia local cifrada con
DPAPI para este usuario de Windows en `apps/backend/supabase/.temp/`, excluida de
Git. No se escriben claves en texto plano ni se cambia la clave de Mistral.

El primer intento quedó en NEEDS_ATTENTION/ANALYSIS_FAILED al leer el cuerpo, sin
request. Su mensaje genérico no permite confirmar la causa exacta. Se añadieron
diagnósticos sanitizados: estado HTTP del proveedor cuando exista, código de
JSON/esquema/respuesta incompleta y rutas formadas solo por campos conocidos del
esquema. No conservar mensajes crudos, claves ni valores extraídos dentro del
error técnico. Se probó y desplegó el worker actualizado ACTIVE v9. Un reintento
explícito del operador de este piloto, con versión/bloqueo y auditoría SYSTEM,
conservó fuentes, avances y contadores; no suplantó una sesión humana ni modificó
las reglas del reintento del panel. El script de operador
`apps/backend/scripts/Test-CustomerServiceEmailPilot.ps1` requiere CLI administrador,
clave DPAPI del mismo usuario y autorización explícita `-RetryAttention` para
reencolar fallos técnicos compatibles; nunca reinicia el presupuesto de fallos.

El reintento terminó PROCESSED y creó una única request **876 / CS-1876** en
NEEDS_REVIEW. El cuerpo y las siete imágenes quedaron ANALYZED; una segunda llamada
al mismo worker/importId devolvió la misma request con idempotentReplay=true, sin
otra inferencia. SELECT independientes confirmaron una request vinculada, siete
referencias, dos intentos totales, cero fallos temporales acumulados, error limpio
y reserva liberada. La request conserva revisión/aprobación nulas. Tiene un
contacto principal con nombre y un ítem descrito; Job y work category siguen
pendientes de completar, sin inventarlos. Las imágenes no produjeron ítems
adicionales; se conservaron sus evidencias y advertencias.

Las pruebas SQL de aprobación usan fixtures y ROLLBACK: no aprueban la request
real. La comprobación visual de CS-1876 y de sus originales en una sesión real
ADMIN/SCHEDULING quedó a la espera del inicio de sesión solicitado al usuario.
No considerar cerrada esa revisión visual ni la aprobación humana. El piloto
contiene imágenes, no PDF; una extracción PDF real y la sincronización periódica
no quedan certificadas por este correo.

**Cambio autorizado el 28 de octubre de 2026 — imágenes de correo sin retención,
implementación por bloques:** las imágenes/fotografías del correo
deben analizarse y, cuando contengan texto, extraerlo. Persistir la información
extraída pertinente a la request, sin conservar los archivos de imagen en
Supabase Storage ni sus bytes/base64 en tablas, payloads, checkpoints o logs. No
crear registros de archivo almacenado ni vínculos de archivo para imágenes
nuevas. Esta decisión sustituye el almacenamiento de JPG/JPEG/PNG confirmado en
los bloques anteriores; esos apartados describen la implementación histórica.
La política de los PDF no cambia por esta solicitud.

Conservar las validaciones de formato, cantidad y tamaños, el análisis de todo
el conjunto, la identidad/idempotencia de la importación, los errores visibles,
NEEDS_REVIEW y aprobación humana. No inventar texto, identidad o trabajos a partir
de una foto/logotipo. Analizar en memoria y mantener solo la extracción y el
seguimiento técnico mínimo necesario; definir ese contrato sin presentar una
imagen como guardada/disponible cuando no se ha retenido su archivo.

El runtime desplegado al iniciar estos bloques guarda las imágenes antes de analizarlas: conector,
manifiesto/RPC de preparación-finalización, worker, checkpoints y visor dependen
de ese contrato. Cambiar solo la subida rompería el procesamiento. La nueva
implementación debe permitir leer de Graph en memoria, reanudar las fuentes
pendientes sin repetir análisis válidos ni sustituir una fuente cambiada, y
adaptar el visor a imágenes analizadas sin archivo retenido, conservando el enlace
al correo original. No sirve subirlas para borrarlas después como sustituto de
la política de no retención.

Las siete imágenes y sus referencias del piloto CS-1876 / request 876 se
conservaron durante los bloques 1 a 3. Después, el usuario indicó que eliminó las
imágenes por su cuenta en Storage. Eso no confirma la limpieza de sus referencias
en BD: no borrarlas, convertirlas ni restaurar los archivos automáticamente.
El visor debe mantener la extracción y reconocer un archivo que ya no se puede
abrir. La limpieza de referencias sigue siendo un trabajo separado. No editar
migraciones ya aplicadas ni dar por certificado el flujo integral sin el piloto.

**Limpieza puntual autorizada y verificada el 30 de octubre de 2026:** a petición
expresa del usuario se eliminaron CS-1876 / request 876 y CS-1974 / request 974,
sus dos importaciones, propiedades exclusivas, cuatro contactos, dos ítems y dos
entradas de historial de workflow. También se retiraron los siete vínculos y
registros de archivo históricos exclusivos de CS-1876, después de comprobar que
sus imágenes ya no existían en Storage y no tenían otras referencias. Esta
operación explícita completa la limpieza separada mencionada arriba; no es una
política de eliminación automática. No se modificó Outlook. Se conservaron todos
los objetos de Storage existentes, la conexión y su cursor, la numeración de
requests, la auditoría previa y las requests CS-1055, CS-1064 y CS-1288. La transacción comprobó
huellas de las filas ajenas y agregó dos eventos de auditoría con identidades y
conteos. Una lectura independiente confirmó las eliminaciones y la conexión sin
cambios. No se reinició la sincronización, activó cron ni reimportaron correos.

**Reimportación real verificada el 30 de octubre de 2026:** después de esa
limpieza, el correo de tres propietarios creó CS-2022 / request 1022 mediante
delta y el worker actuales: tres contactos con teléfonos +1 coincidentes con
su fuente y Doors / General fix / 30 minutos / crew 1. El segundo correo fue
visible por lectura directa de Graph, pero no se entregó en las consultas
incrementales realizadas; se recuperó exclusivamente ese mensaje mediante los
adaptadores existentes de fuentes V2, con auditoría y sin cambiar el cursor ni
Outlook. El worker creó CS-2023 / request 1023, con un contacto y la misma
planificación 30/1. Ambas siguen NEEDS_REVIEW y sus replays devolvieron la misma
request. Se analizaron once imágenes sin nuevos archivos, vínculos o binarios;
las tres requests ajenas y Storage permanecieron intactos. Esta recuperación
manual no certifica la detección delta del segundo correo, cuya causa sigue
pendiente de diagnóstico antes de activar periodicidad. No se activó cron ni
se aprobó ninguna request. Ver [resultado y límites de la prueba](customer-service-email-retest-2026-10-30.md).

**Consulta automática aprobada el 30 de octubre de 2026, preparada localmente:**
consultar la carpeta de Outlook cada minuto. Invocar el worker solo cuando haya
trabajo elegible, incluidos reintentos vencidos, continuaciones y reservas
interrumpidas, con protección frente a llamadas programadas superpuestas.
Comprobar los IDs/enlaces de la carpeta cada 15 minutos para señalar correos sin
registro, excluyendo la línea base y los ya importados. Esta comprobación no
autoriza reimportaciones históricas automáticas ni reiniciar el cursor delta;
los faltantes se muestran para revisión y se enlazan al correo cuando Graph
facilita una URL válida. El piloto manual no demuestra que esa detección haya
quedado resuelta: la comprobación reduce el riesgo y hace visible la discrepancia.

La migración nueva `20261030180000_customer_service_email_automation.sql` instala
el job pausado; una activación explícita posterior a migración, despliegues y
configuración de Vault lo habilita. Pausar conserva cola, cursor, identidad y
análisis; una ejecución ya iniciada puede terminar. El transporte programado usa
firmas temporales consumibles una sola vez, no claves permanentes en pg_net.
Requests consulta un resumen ligero, informa fallos/pausa y recarga solo al
cambiar la revisión; conserva la versión de una edición abierta. Se mantienen
NEEDS_REVIEW, aprobación humana, imágenes en memoria y PDF privados. Diez correos
diarios es una estimación, no un límite aprobado. La periodicidad no garantiza
que el análisis termine dentro de un minuto. No se desplegó ni activó este cambio
durante su implementación; ver [validación y activación](customer-service-email-automation.md).

**Imágenes sin retención — bloque 1 preparado el 28 de octubre de 2026:** la
migración nueva `20261028180000_customer_service_image_source_contract.sql`
prepara un contrato V2 explícito: manifiesto completo con imágenes GRAPH_ONLY
sin archivos/vínculos almacenados, PDF STORED con el tratamiento actual, origen
Graph fijado y avances/análisis identificados por adjunto y SHA-256. Permite
conservar texto/hechos pertinentes sin binarios/base64; añade lectura autenticada
de esa evidencia para el futuro visor. Mantiene NEEDS_REVIEW y aprobación humana.

V1 conserva fuentes, manifiestos y archivos históricos, incluidos los pendientes
ya fijados; no se convierten ni limpian automáticamente. Las altas del conector
actual continúan en V1 hasta adaptar el runtime. El claim actual no toma V2 sin
request; el worker futuro deberá optar por el RPC V2 y recuperar imágenes de
Graph en memoria. Instalar este bloque no activa la política completa ni cron.
La migración se comprobó aplicada remotamente el 28 de octubre. Historial y
dry-run verificados; quince suites SQL distintas pasaron en preview remoto con ROLLBACK. No se desplegaron
Edge Functions, invocó IA ni modificó el piloto. Ver
[contrato, validación y comandos del bloque 1](customer-service-image-no-retention-block-1-testing.md).

**Imágenes sin retención — bloque 2 preparado el 28 de octubre de 2026:** el
conector local usa V2 para las fuentes nuevas, valida todos los adjuntos en
memoria y sube solo PDF. Proyecta cabeceras/destinatarios por campos permitidos y
rechaza cuerpos con data URI/base64 sin conservar su cuerpo ni archivos parciales.
Los originales de imágenes permanecen en Microsoft 365; se fijan identificadores,
metadatos y hash para su recuperación posterior. No ejecuta IA ni crea requests.

La migración nueva `20261028200000_customer_service_graph_image_intake.sql`
restringe las cargas nuevas del bucket de importaciones a PDF, sin borrar ni
alterar imágenes históricas. Añade recuperación V2 explícita/auditada, manteniendo
rechazos de tamaño autorizados, versión, reservas, cursor y manifiesto inmutable;
no convierte V1 fijados. El delta deja visibles los V1 pendientes con imágenes,
sin nuevas subidas. Los V1 publicados y PDF históricos conservan su tratamiento.
IMPORT_EXISTING puede preparar su primera ronda; BASELINE_ONLY conserva su corte.

Pasaron 86 pruebas del conector, 59 regresiones de adjuntos/almacenamiento, tipos,
lint y trece suites SQL distintas en preview remoto con ROLLBACK. La migración
se verificó aplicada remotamente al iniciar el bloque 3; el redespliegue de
`customer-service-email-sync` no se comprobó en esa entrega. No se ejecutó
un correo real ni se modificaron CS-1876 o sus siete archivos. Las fuentes V2
quedan en cola para el worker del bloque 3; su análisis y creación automática de
requests todavía no están activos. El visor corresponde al bloque 4. No se
activa ejecución periódica. Ver
[alcance, pruebas y comandos del bloque 2](customer-service-image-no-retention-block-2-testing.md).

**Imágenes sin retención — bloque 3 preparado el 28 de octubre de 2026:** el
worker local usa el claim V2 compatible con V1 y recupera desde el origen Graph
fijado únicamente imágenes pendientes. Revalida tamaño, formato y SHA-256 antes
de la inferencia; conserva texto pertinente y hechos extraídos, con fileId nulo
y sin archivos/vínculos de imagen. Los PDF y originales V1 mantienen Storage.
Una imagen sin texto es válida sin inventar contenido. La extracción de visión
exige una respuesta estructurada con texto nullable y hechos del contrato actual.

Los avances válidos se reutilizan por identidad/hash; fallos, archivos cambiados
o ausentes bloquean el alta parcial y dejan diagnósticos seguros. La nueva
migración `20261028220000_customer_service_image_worker.sql` conserva Retry-After
en el próximo intento, los límites de fallos y las reservas; una continuación
por presupuesto o espera de conexión no consume fallos. Una conexión deshabilitada
se distingue de una reserva perdida. IMPORT_EXISTING puede analizar imágenes
antes de terminar su primera ronda. El alta sigue siendo única en NEEDS_REVIEW,
sin aprobación automática. La revisión posterior del 28 de octubre confirmó la
migración aplicada y los despliegues ACTIVE de sync v9, worker v10 y retry v6;
sus fuentes y definiciones SQL se contrastaron con el código local. No quedan
migraciones pendientes. No se invocaron Graph/Mistral reales ni se activó cron. El visor
corresponde al bloque 4 y no se limpian las siete imágenes históricas.
Ver [pruebas y comandos del bloque 3](customer-service-image-no-retention-block-3-testing.md).
La [confirmación de despliegues](customer-service-image-deployment-verification-2026-10-28.md)
detalla la comparación del código, permisos y comprobaciones HTTP sin procesamiento.

**Imágenes sin retención — bloque 4 implementado localmente el 28 de octubre de
2026:** el visor compartido de View/Edit Request usa la lectura autenticada del
manifiesto y análisis V1/V2. Lista todas las imágenes nuevas, incluidas inline,
sin depender de un fileId; la selección se identifica por attachmentId. Presenta
texto pertinente y hechos/advertencias por adjunto, distingue análisis correcto
sin texto, fallido y no registrado, y conserva el enlace al correo de Outlook.
Una imagen GRAPH_ONLY no solicita vistas previas, enlaces ni descargas. Los PDF
y originales históricos con referencias mantienen su acceso privado; si un
archivo fue eliminado, su error no oculta la extracción ni provoca una restauración.
Los mensajes de retención ya no afirman que todos los originales están guardados.

No cambia edición, revisión/aprobación humanas, worker, Graph, Storage ni BD.
No requiere migración ni redesplegar funciones. Pasaron 453 pruebas frontend,
lint, build y comprobaciones Playwright con datos simulados en escritorio/móvil.
La publicación frontend y el piloto integral real siguen pendientes; no se
activa cron. Ver [validación del bloque 4](customer-service-image-no-retention-block-4-testing.md).

**Piloto V2 real autorizado el 29 de octubre de 2026:** el usuario añadió un
correo para probar texto y proporcionó el secreto de sincronización mediante un
archivo local. La sincronización creó únicamente la importación
`f118794d-b785-4e18-83d9-44aecbd17e29`, V2/AVAILABLE. Graph detectó cuatro imágenes
inline aunque el correo parecía solo texto; se analizó el conjunto completo.
El cuerpo y las cuatro imágenes terminaron ANALYZED, sin errores del proveedor
ni archivos/vínculos/objetos nuevos de Storage o binarios en el registro V2.

La importación quedó NEEDS_ATTENTION / ANALYSIS_INCOMPLETE por
MISSING_OR_AMBIGUOUS_HOMEOWNER: el texto contiene tres propietarios y no define
un contacto principal único. Se conservaron los tres y un trabajo descrito; no
se eligió uno arbitrariamente, cambió la regla ni creó una request. Repetir worker
sin reencolar devolvió IDLE sin nueva inferencia; repetir sync no importó otro
mensaje. El siguiente folio siguió siendo CS-1974. La numeración manual y de correo
comparte la secuencia del servidor y puede contener saltos; no se reinició.
El caso estrictamente sin adjuntos y la resolución humana siguen pendientes.
No se repitieron las dos etapas de pruebas descartadas por el usuario ni se activó
cron. Este es el resultado inicial, anterior a la decisión siguiente. Ver
[resultado del piloto](customer-service-email-pilot-2026-10-29.md).

**Varios propietarios — decisión aprobada el 29 de octubre de 2026:** usar como
contacto principal al primer propietario identificado en el correo, respetando
el orden de aparición de los contactos y del cuerpo antes de los adjuntos. No
ordenar nombres alfabéticamente ni sustituir al propietario por el remitente o
representante del constructor. Tener varios propietarios no bloquea por sí solo
la creación de la request NEEDS_REVIEW. Conservar todos en la extracción original
y mostrar una advertencia para revisión. El límite inicial de un adicional fue
sustituido por la ampliación siguiente. No se inventan
nombres ni se relajan sus límites, la validación de fuentes o la aprobación humana.
La nueva selección puede calcularse desde checkpoints válidos sin repetir IA ni
recuperar imágenes ya analizadas. Su aplicación al piloto se registra en su guía.

**Corrección verificada en ese piloto:** la misma importación creó únicamente la
request **974 / CS-1974**, NEEDS_REVIEW, con el primer propietario como principal
y los tres conservados en la extracción. Repetir worker devolvió la misma request.
Cero archivos/vínculos/objetos nuevos de imagen y cero binarios en el registro.
La recuperación detectó y corrigió además una comparación sensible al orden de
claves jsonb que repitió el análisis del cuerpo. El código final reutiliza los
cinco checkpoints reales sin proveedor, descargas ni nuevas escrituras en una
comprobación en memoria. Pasaron 74 pruebas de análisis y 44 de worker, tipos y
lint. Worker ACTIVE v12, retry ACTIVE v8; sync permanece ACTIVE v9. Sin migración
ni cron. La aprobación humana continúa pendiente; la corrección no la ejecuta.

**Nombre del propietario — corrección, bloque 1 autorizado e implementado
localmente el 2 de noviembre de 2026:** el nombre explícito de una persona
corresponde a `name`; `sourceLabel` identifica únicamente una etiqueta visible
del campo/rol y puede ser null. El extractor debe revisar también nombres antes
de teléfono/dirección en correos reenviados y separar las firmas del builder.
No convertir una etiqueta, remitente o representante del constructor en un
propietario para completar el mínimo. Si falta el dato o hay ambigüedad,
conservarlo pendiente y mantener la validación de alta y aprobación humana.

Las instrucciones y descripciones del esquema se reforzaron sin cambiar su
estructura. La extracción nueva de texto de correo comprueba nombres de
HOMEOWNER/PRIMARY_CONTACT contra ese texto, tolerando mayúsculas, acentos,
espacios y puntuación. Una etiqueta genérica conocida o un nombre no verificable
queda null con advertencia, conservando evidencia, roles y orden. Nunca se
copia silenciosamente un `sourceLabel` al nombre. Los campos PDF identifican
explícitamente su tipo de fuente para conservar nombres compuestos desde
valores separados; no se les aplica la coincidencia de nombre completo del
cuerpo del correo. Se mantienen validación integral y política sin binarios.

Este bloque no modifica checkpoints históricos, reencola ni recupera la
importación del piloto. El reintento selectivo del texto y la recuperación
pertenecen al bloque 2. Sin migración ni despliegue en este bloque; el despliegue
se hará conjunto al cerrar el bloque 2, conforme al plan acordado. Pasaron
164 pruebas Deno simuladas y los tipos de worker, retry y extracción manual.
Ver [alcance, límites y pruebas](customer-service-homeowner-name-block-1.md).

**Nombre del propietario — bloque 2 autorizado e implementado localmente el
2 de noviembre de 2026:** el reintento existente mantiene la misma importación.
Cuando el informe previo indica MISSING_OR_AMBIGUOUS_HOMEOWNER, revisar solo
fragmentos EMAIL históricos con un HOMEOWNER sin nombre. Conservar análisis
válidos, identidad y comprobaciones de fuentes; no promover sourceLabel al
nombre. Las imágenes correctas no se vuelven a descargar ni analizar.

Una extracción de texto nueva y válida guarda el metadato opcional
contactNameVersion = 1. La marca sobrevive a continuaciones y evita repetir la
misma corrección. Si sigue sin nombre, queda pendiente para revisión humana,
sin un bucle de inferencia; los fallos reales mantienen los reintentos limitados
existentes. No se agrega aprobación automática ni se modifican requests
vinculadas. No se reencolan automáticamente importaciones históricas.

La migración nueva `20261102180000_customer_service_email_text_analysis_version.sql`
amplía el validador V2 con ese entero opcional, sin archivos, nuevas tablas ni
binarios; conserva payloads anteriores. Pasaron 171 pruebas Deno, tipos y tres
suites pgTAP remotas con la migración en BEGIN/ROLLBACK. Migración, despliegues
conjuntos worker/retry y recuperación real siguen pendientes del usuario;
ninguna prueba aplicó la migración, modificó registros históricos o llamó
Graph/Mistral reales.
Ver [validación, límites y comandos del bloque 2](customer-service-homeowner-name-block-2.md).

**Recuperación del piloto observada el 2 de noviembre de 2026:** tras el
reintento del usuario, la misma importación quedó PROCESSED, sin error y con
una única request CS-2031 / ID 1031 en NEEDS_REVIEW. El texto conserva la versión
1 y las dos imágenes permanecen ANALYZED. La aprobación sigue pendiente.
La consulta posterior encontró cero importaciones NEEDS_ATTENTION y un resultado
programado antiguo IMPORT_NEEDS_ATTENTION. Se corrigió localmente el aviso del
frontend para que ese resultado de WORKER no se presente como activo cuando
el contador actual sea exactamente cero. Se conservan el historial técnico,
los errores técnicos reales y los avisos de correos sin registro. No se invoca
un worker vacío ni se repite IA para limpiar un aviso. Pasaron 49 pruebas de
frontend relacionadas, lint y build; sin migración ni Edge Functions nuevas.
Ver [evidencia de recuperación y aviso](customer-service-email-automatic-test-2026-11-02.md).

**Bandeja intuitiva de correos — bloque 1 aprobado y preparado localmente el
2 de noviembre de 2026:** distinguir PROCESSING, REQUIRES_ACTION y REGISTERED
como estados operativos del correo, sin añadir etapas a la request. Un registro
correcto muestra su request y conserva pendiente la aprobación humana. Una
request con recuperación PDF aún incompleta continúa requiriendo acción.

ADMIN/SCHEDULING activos pueden confirmar que un correo del inventario sin
importación corresponde a una request existente, con versión, controles de
concurrencia y auditoría. No resolver por parecido de asunto/dirección ni
cerrando visualmente un aviso. No reemplazar la importación, fuente o request
de un mensaje ya importado; usa su recuperación existente. Un vínculo vigente
no se reasigna silenciosamente y una repetición al mismo destino es idempotente.

Los vínculos confirmados se conservan independientemente del inventario y dejan
de contar como pendientes. La sincronización excluye esa identidad exacta
antes de descargar fuentes o crear importaciones, verificando el destino real.
Si se elimina legítimamente la request, el vínculo queda invalidado y el correo
vuelve a requerir acción al figurar en la carpeta. Mantener las protecciones de
eliminación existentes, el historial y quién confirmó. Guardar solo metadatos;
sin archivos, bytes/base64, cambios de cursor/línea base ni aprobación automática.

Migración nueva `20261102200000_customer_service_email_message_resolution.sql`,
RPC de lectura/confirmación y sync preparados para instalación por el usuario.
Pasaron 157 pruebas Deno, tipos, lint y cinco suites SQL remotas con rollback.
No se aplicó la migración ni se vincularon los dos correos reales; la interfaz y
su confirmación corresponden al bloque 2. Ver
[alcance, límites y comandos](customer-service-email-inbox-block-1.md).

**Bandeja de correos — bloque 2 autorizado e implementado localmente el
2 de noviembre de 2026:** Requests muestra una bandeja Correos de Outlook con
estados/motivos/acciones por mensaje, contadores de correos y folio/enlace a su
solicitud. La salud de conexión se informa por separado; un resultado de negocio
IMPORT_NEEDS_ATTENTION corresponde al correo, no a una conexión fallida. Los
errores técnicos reales permanecen visibles. No cerrar advertencias para
suponer que un caso fue atendido.

Después de reintentar o confirmar un vínculo, consultar el estado guardado:
solo declarar Registrado con request y folio confirmados. Mostrar la revisión
humana pendiente por separado. Actualizar lista, detalle y contadores; una
respuesta perdida se reconcilia leyendo, sin repetir automáticamente IA o la
mutación. Un resultado incierto exige Actualizar estado; una comprobación
posterior exitosa elimina su advertencia anterior. La versión de formularios
abiertos y los cambios humanos se conservan.

La vinculación exige seleccionar una solicitud, comparar propietario/dirección/
trabajo y confirmar el mismo caso. No seleccionar por parecido ni aprobar por
vincular. Mensajes sin importación que sean casos nuevos pueden capturarse en
New Request y vincularse después; no hay reimportación histórica automática.

La migración nueva `20261102210000_customer_service_email_inbox_metadata.sql`
añade cabeceras seguras y lectura individual autenticada. Reconcile recoge
asunto, remitente y fecha durante el inventario existente, sin cuerpos, adjuntos
ni imágenes. Si aún faltan cabeceras, indicar la espera de la próxima revisión
de 15 minutos y permitir abrir el original. No forzar Graph/worker al refrescar
la bandeja. Mantener límites, permisos, auditoría y política PDF/imágenes.

Pasaron 489 pruebas frontend, 158 Deno, tipos, lint/build, tres suites SQL remotas
con rollback y pruebas visuales Playwright con datos simulados. Migración,
despliegue reconcile y publicación frontend pendientes del usuario. Los dos
vínculos reales no se confirmaron y el piloto integral corresponde al bloque 3.
Ver [alcance, pruebas y comandos](customer-service-email-inbox-block-2.md).

**Idioma y claridad de la bandeja — corrección autorizada el 2 de noviembre
de 2026:** toda copia de producto debe estar en inglés, incluidos avisos,
acciones, validaciones y errores. Conservar el idioma de los correos y de sus
evidencias originales. La conversación y documentación pueden estar en español.
Esta regla también queda explícita en AGENTS.md.

Separar visualmente **Emails to match** (mensajes originales o reenviados sin
vínculo confirmado) de **Import issues** (importaciones que realmente necesitan
atención). Son contadores de correos, no de requests; mantienen los tres estados
operativos existentes. Una request NEEDS_REVIEW no es un fallo de importación.
La existencia de una request con datos parecidos no resuelve NO_IMPORT.

Ofrecer **Match existing request** directamente en cada correo sin vínculo:
leer su versión actual, seleccionar la request, comparar el mismo caso y exigir
confirmación humana. Al guardar y verificar el vínculo, quitar ese correo de
To review y mostrarlo en Registered con su folio; no crear requests ni aprobarlas.
No cerrar por parecido ni borrar el inventario para esconder pendientes.

La consulta remota de diagnóstico confirmó cero importaciones fallidas y dos
mensajes NO_IMPORT sin resolución guardada; CS-2022 y CS-2031 existen. Estos
vínculos reales siguen pendientes de confirmación humana. La migración nueva
`20261102220000_customer_service_email_review_counts.sql` añade contadores sin
modificar datos o funciones Edge. Aplicar antes de publicar el frontend nuevo.
Pasaron 492 pruebas frontend, lint/build y tres suites SQL remotas con rollback;
la interfaz se verificó con datos simulados en escritorio y móvil. Ver
[corrección, diagnóstico y comandos](customer-service-email-inbox-english-review.md).

**Ampliación de customers y teléfonos aprobada el 29 de octubre de 2026:** el
usuario indicó que deben incorporarse dos o hasta los tres propietarios del
correo. La request admite **tres customers en total: un principal y hasta dos
adicionales**. El primero sigue siendo principal y los otros dos se completan
con sus propios datos, respetando el orden del correo. Add another customer
permite añadir ambos adicionales; crear, editar, releer y aprobar deben conservar
los tres. Si hay más de tres, mantener los demás en la extracción con advertencia
visible, sin pérdidas silenciosas. Los representantes del constructor no se
convierten en propietarios. La revisión y aprobación validan cada contacto.

Los teléfonos de diez dígitos sin prefijo reciben **+1 únicamente cuando la
dirección fuente identifica Estados Unidos**. Para esta extracción, comprobar
estado estadounidense y ZIP válidos; un número de diez dígitos aislado no define
país. Conservar los números fuente sin cambios y advertir la normalización para
revisión. Respetar prefijos explícitos +1/+52 y no elegir arbitrariamente entre
varios números diferentes del mismo contacto. Otros casos ambiguos siguen
pendientes, sin sustituir la aprobación humana. Esta regla reemplaza el requisito
anterior de prefijo explícito también en fuentes claramente estadounidenses.

**Verificación de esta ampliación:** la migración nueva `20261029190000` quedó
aplicada y CS-1974 conserva su mismo ID con tres customers y tres teléfonos
coincidentes con la fuente y normalizados a +1. La corrección fue auditada, sin
nueva IA, cambios de originales/análisis/checkpoints, imágenes almacenadas o
duplicados. Continúa NEEDS_REVIEW sin aprobación. Pasaron 456 pruebas frontend,
78 de análisis, 44 de worker, ocho suites SQL en preview remoto y las 23
aserciones de la suite nueva contra el esquema aplicado, más lint/tipos/build
y pruebas de navegador aisladas. El formulario está preparado localmente; no
se publicó el frontend. Ver [implementación y pruebas](customer-service-three-customers-2026-10-29.md).
Versiones finales verificadas: worker ACTIVE v14, retry ACTIVE v10, sync ACTIVE v9.

## 4. Estados y vistas

| Vista | Estados de request que le corresponden | Uso |
| --- | --- | --- |
| Requests / Review Request | `NEEDS_REVIEW`, `READY_TO_PROPOSE` | Capturar, corregir y aprobar información |
| Proposal Workspace | `READY_TO_PROPOSE`, `AWAITING_CUSTOMER`, `NEEDS_CONTACT` | Preparar propuestas y dar seguimiento |
| Calendar | `CONFIRMED`, `WORKING` y `COMPLETED` | Consultar citas aceptadas, en curso y terminadas |

- Workspace abre inicialmente en **Ready to propose**; los otros estados se
  consultan mediante sus filtros de seguimiento.
- `NEEDS_REVIEW` no pertenece a Workspace. Una request que pierde su aprobación
  vuelve a Requests; no se cambia artificialmente su estado para mostrarla allí.
- **Overdue** es una alerta de vencimiento, no otro estado del proceso.
- Carga, error de envío, borrador guardado o análisis desactualizado son estados
  de la operación/interfaz; no nuevas fases de la request.
- Guardar el borrador conserva `READY_TO_PROPOSE`. Enviar pasa a
  `AWAITING_CUSTOMER`; aceptar pasa a `CONFIRMED`; al comenzar la ventana del
  cliente pasa automáticamente a `WORKING`; finalizar pasa a `COMPLETED`.
- La propuesta vence 48 horas después de su envío. A las 24 horas sin respuesta
  se simula un recordatorio; al vencer sin respuesta se marca para contactar al
  cliente.
- Tanto un rechazo como una expiración regresan la request a `READY_TO_PROPOSE`.
  Workspace conserva la respuesta y el motivo y muestra respectivamente
  **Propuesta rechazada · preparar otra** o **Propuesta vencida · contactar**.
  En ambos casos se libera inmediatamente la ventana reservada para que pueda
  utilizarse en otro servicio.
- El uso de `CLOSED` queda sujeto a las decisiones de cancelación y cierre; no
  añadir otra fase por anticipación.

## 5. New Request y Review Request

### Propiedad y contactos

- Conservar **Builder**, **Project / Job**, **Lot #**, **Address** y
  **Coordinates**. En Customer Service, Project corresponde al Job. Lot # y
  dirección son opcionales individualmente; no incluir **Plan**.
- Las coordenadas se pegan juntas en un campo: `latitud, longitud`.
- New Request y Review Request leen los Builders y Jobs activos ya registrados
  mediante los providers existentes respaldados por Supabase. Elegir un Builder
  filtra sus Jobs; elegir un Job carga su Community y sus coordenadas verificadas.
  Cambiar el Builder limpia Job y coordenadas; cambiar el Job reemplaza las
  coordenadas para evitar conservar la ubicación anterior.
- Los Jobs persistentes son la fuente de Builder, Job y coordenadas para Customer
  Service. La creación y la edición guardan la referencia al Job seleccionado y
  toman sus coordenadas verificadas de la base, sin permitir que el cliente las
  sustituya.
- Para aprobar se requieren coordenadas válidas, aun si existe dirección. Si el
  Job seleccionado no entrega coordenadas válidas, se bloquea el guardado y debe
  corregirse el Job; no se inventa ni sustituye silenciosamente su ubicación.
- Si se proporcionan coordenadas, validar el par completo: latitud entre -90 y
  90 y longitud entre -180 y 180. No confundir un valor inválido con uno ausente.
- Customer permite un contacto principal y hasta dos contactos adicionales. No incluir
  el selector eliminado de mail / phone / text message.
- En importación con varios propietarios, el primero del correo es el principal
  por decisión del 29 de octubre de 2026; los demás permanecen en la extracción
  para revisión y los dos siguientes se completan en los espacios adicionales.
- Para aprobar, tanto el contacto principal como cualquier contacto adicional
  capturado requieren nombre y al menos un medio de contacto válido: correo
  **o** teléfono. No es obligatorio capturar ambos medios. Decisión confirmada
  el 19 de octubre de 2026.
- No pedir disponibilidad ni días bloqueados del cliente durante New Request:
  todavía no ha respondido a una propuesta.

### Clasificación y trabajos

- **Service kind**, en este orden: Adjustment, Replacement, Paid Extra.
- Una New Request inicia sin **Service kind** ni **Work type** preseleccionados.
  Ambos campos permanecen vacíos hasta que la extracción proponga un valor o la
  coordinadora lo seleccione; no se debe asumir una clasificación por defecto.
- **Service kind**, **Work type** y **Service task** se asignan a toda la request,
  no individualmente a cada ítem. Decisión confirmada el 14 de octubre de 2026.
- **Work type**: Exterior Frames, Doors, Moldings, Hardware, Weatherstripping,
  Shelving y **Multiple work types**. Esta última se usa cuando una misma request
  contiene ítems de más de una categoría; no representa una categoría técnica
  adicional. Las mismas opciones aparecen en el formulario y en los filtros del
  calendario.
- **Service task** identifica la tarea de planificación; no confundirlo con
  Service kind ni Work type. No incluir **Short title**.
- Una request puede contener **varios ítems**. La coordinadora decide los que
  corresponden y revisa su alcance; no crear obligatoriamente una request por ítem
  ni conservar un selector obligatorio **Service item loaded** para ese fin.
- Cada ítem tiene descripción e indicadores **Material** y **Chargeable**.
- No incluir automáticamente trabajos asignados explícitamente a otro proveedor.
  Los trabajos sin asignación clara requieren revisión de Valtrim.
- La IA prepara información editable; no confirma por sí sola el proveedor,
  el servicio, la duración ni la aprobación de la solicitud.

### Guardar para revisión frente a aprobar

- **Reported on** es la fecha fuente que inicia el plazo: primero la fecha del
  correo externo original enviado a Valtrim; si solo hay PDF, **Order Date**; si
  falta, una **Scheduled Date** no futura queda como último respaldo revisable.
  Los reenvíos internos entre cuentas de Valtrim no reinician el plazo.
- **Reported on** se muestra y captura con el formato de Estados Unidos
  `MM/DD/YYYY`. Internamente se conserva como `YYYY-MM-DD` para cálculos y datos,
  sin depender de la configuración regional del navegador.
- **Created on** registra automáticamente, en hora de California, cuándo se
  guardó la request. No se muestra en el formulario de captura ni sustituye
  **Reported on**; permanece disponible en el detalle después de guardar.
- La interfaz identifica el origen de **Reported on** como correo original,
  Order Date, Scheduled Date o captura manual. Una corrección manual no se
  sobrescribe silenciosamente durante otro análisis. Debajo de esa fecha se
  muestra también el **Due on** calculado; no se duplica como campo separado.

- **Save for review** exige los datos básicos de captura: Reported on, Builder,
  Project / Job, coordenadas válidas, nombre del cliente, al menos correo o
  teléfono válido y un ítem con descripción. La clasificación pendiente,
  Service task, duración o crew todavía pueden completarse durante la revisión.
- Esa validación describe la captura manual actual. Para la importación desde
  correo, la decisión del 21 de octubre permite guardar requests incompletas en
  NEEDS_REVIEW y completarlas durante la revisión, sin relajar los requisitos de
  aprobación. No extender automáticamente el cambio al alta manual.
- La captura incompleta no permite guardar valores inválidos como si fueran
  datos correctos. Mostrar qué falta y qué necesita corrección.
- Antes del primer intento de guardar, los campos se muestran con apariencia
  normal y un asterisco rojo identifica los obligatorios. Al intentar guardar,
  los faltantes cambian a error rojo y el formulario lleva el foco al primero;
  al corregirlos, se revalidan sin exigir otro intento para limpiar el error.
- **Mark ready to propose** requiere información completa para planificar:
  builder, Project / Job, coordenadas válidas, nombre y correo o teléfono del
  contacto, clasificación, descripciones,
  duración y crew; además, confirmación explícita de que los ítems son de Valtrim.
- El RPC del bloque 3 admite únicamente NEEDS_REVIEW sin cita vigente; rechaza
  estados posteriores, solicitudes cerradas y versiones obsoletas. El revisor y
  la fecha no provienen del navegador. Si las coordenadas guardadas ya no
  coinciden con las verificadas del Job, exige editar/guardar y revisar la
  ubicación actual antes de aprobar; no cambia silenciosamente lo revisado.
- Las advertencias de extracción o un PDF opcional PENDING/FAILED no sustituyen
  la validación humana ni bloquean por sí solos una request completa. La
  aprobación no modifica la fuente, el OCR/JSON ni el estado real de su archivo.
- Review reutiliza **View/Edit Request** y el folio existente. No crear otro
  formulario independiente para revisar.
- Las advertencias de IA se muestran para revisión. No bloquear la aprobación
  solo por una advertencia si la información necesaria está revisada y completa.

## 6. Duración y crew

No existe una duración global predeterminada para todos los servicios. Service
task propone una estimación editable; la coordinadora revisa duración y personal.

**Planificación compartida aprobada el 29 de octubre de 2026:** aplicar en la
importación las mismas sugerencias de clasificación y el mismo catálogo/cálculo
de duración y crew del frontend. Una sola regla portable sirve al formulario,
extracción PDF/texto e importador. General fix con un ítem descrito propone
30 minutos y una persona; los demás rangos y tareas conservan la tabla vigente.
No pedir estas estimaciones al modelo ni presentarlas como hechos del correo.
La clasificación se propone para todos los trabajos incluidos; tareas o Service
kind incompatibles permanecen pendientes, sin elegir el primer ítem. Work types
distintos usan Multiple work types. Las discrepancias explícitas entre fuentes
detectadas por el merger no se sustituyen por una inferencia de palabras clave.

Al abrir en edición una NEEDS_REVIEW con campos de servicio vacíos, proponer los
faltantes desde su alcance actual y tarea seleccionada. Un campo vacío no es una
duración manual. Conservar valores ya proporcionados y cambios humanos; permitir
descartar las sugerencias y no reponer un campo que la persona borre durante esa
misma edición. Los cambios propuestos se muestran como pendientes de guardar;
abrir View, una request bloqueada o el editor no escribe en la BD. Una captura
nueva sin fuente/ítems sigue sin clasificación o tarea preseleccionada.

La nueva regla está implementada y validada. Después de los despliegues del
usuario se confirmaron worker ACTIVE v15 y retry ACTIVE v11: sus 21 y 23 archivos
coinciden con el código local, incluido el módulo compartido y el intake nuevo.
Se comprobó arranque HTTP sin procesar correos; no se verificó la publicación
del frontend. No requiere migración ni modifica automáticamente requests ya
procesadas como CS-1974.
Su revisión usa Edit → comprobar sugerencias → Save changes, con la misma
versión y aprobación humana independiente. Ver
[implementación y pruebas](customer-service-planning-rules-2026-10-29.md).

| Service task | Tiempo de referencia acordado |
| --- | --- |
| General fix | Según cantidad de ítems con descripción |
| Exterior door replacement | 120 minutos |
| Exterior frame replacement | 120 minutos |
| Shutter replacement | 120 minutos; requiere 2 personas |
| Shelving replacement | 60 minutos |

Para **General fix** exclusivamente:

| Ítems con descripción no vacía | Duración sugerida |
| --- | --- |
| 1–6 | 30 minutos |
| 7–9 | 45 minutos |
| 10 o más | 60 minutos |

- Las filas vacías no cuentan. Cero ítems descritos no permite guardar una request.
- Añadir o quitar ítems puede actualizar el tiempo sugerido de General fix.
- Una duración modificada manualmente no se sobrescribe automáticamente por
  cambios en el número de ítems.
- Estos rangos no se aplican a las otras Service Tasks.
- El crew sugerido restante se toma del catálogo frontend actual y se revisa;
  no inventar personal ni deducirlo únicamente por el nombre de un trabajo.
- La ventana de llegada de dos horas **no** es la duración del trabajo.

## 7. Jornada, ventanas y reservas

- Citas de **lunes a viernes**. Jornada operativa: **07:00–15:30**.
- Fechas y horarios operativos se interpretan en **America/Los_Angeles** (California),
  aunque la coordinadora utilice el sistema desde otra zona. Decisión confirmada
  el 13 de octubre de 2026. Workspace utiliza esa zona para su fecha inicial,
  fecha mínima y validación de fechas/horas pasadas, incluyendo horario de verano.
  La agenda identifica California; Calendar utiliza su día operativo para Today
  y la referencia de hora actual. No se cambia la zona horaria del dispositivo.
- Ventanas del cliente: **08:00–10:00**, **10:00–12:00** y **12:00–14:00**.
  Las tres están activas bajo las mismas reglas; 12:00–14:00 ya no requiere una
  autorización excepcional. Decisión confirmada el 14 de octubre de 2026.
- No añadir un margen fijo de 30 o 45 minutos entre citas. La viabilidad de los
  traslados se revisa como parte de la ruta, no mediante el antiguo buffer global.
- Separar ventana del cliente de inicio/fin internos. El trabajo debe empezar
  dentro de la ventana seleccionada y finalizar dentro de la jornada; su fin
  interno puede superar el fin de la ventana de llegada.
- Las transiciones de estado se basan exclusivamente en la ventana del cliente,
  no en el horario interno: `WORKING` al inicio y `COMPLETED` al final, aunque el
  fin interno calculado sea posterior.
- Al seleccionar una ventana diferente, ajustar el inicio interno al inicio de
  esa nueva ventana y recalcular el final con la duración revisada. La coordinadora
  puede ajustar el inicio después; no conservar automáticamente una hora de la
  ventana anterior. Esto no libera reservas ni guarda el borrador por sí solo.
- Seleccionar suficientes integrantes para cubrir el crew y comprobar cada
  técnico involucrado. No basta con que uno esté disponible.

### Conveniencia por distancia confirmada

- La integración prevista es **Google Maps Routes API** y se realizará más
  adelante con backend y base de datos. El frontend actual no inventa millas,
  regiones, tiempos ni resultados de ruta para simular esa integración.
- Conservar como futuro origen de la empresa las coordenadas
  `34.002337529815094, -117.34682148254083`.
- Las sugerencias comparan únicamente otros trabajos de Customer Service que el
  cliente ya confirmó. No usan borradores, propuestas pendientes ni Production.
- Un trabajo a **5 millas o menos** puede proponerse cualquier día hábil viable,
  pero también debe favorecer días con trabajos confirmados cercanos.
- Los trabajos de **más de 5 y hasta 20 millas** también deben favorecer días con
  trabajos confirmados cercanos.
- Para un trabajo a **más de 20 millas**, favorecer especialmente un día con otro
  trabajo confirmado cercano para realizar una sola vuelta.
- Estas recomendaciones no bloquean a Anelda: puede elegir cualquier día válido
  y enviar la propuesta. Si no hay trabajos cercanos, no se muestra sugerencia.
- Cuando exista el cálculo real, la página pública solo debe ofrecer días
  geográficamente compatibles con las citas confirmadas; por ejemplo, no ofrecer
  un día con ruta al norte para un trabajo al sur. La definición exacta de
  compatibilidad provendrá de Routes API, no de una regla regional inventada.
- Mientras Routes API no esté integrada, el selector público muestra la leyenda
  **Filtro geográfico pendiente** y no bloquea días por ubicación.
- El cliente puede seleccionar disponibilidad únicamente dentro de los **cinco
  días hábiles posteriores a Reported on**. El día de **Reported on** no cuenta.
  Se siguen excluyendo los días no elegibles por calendario o reservas conocidas.

### Reserva de la ventana completa — decisión vigente

- `CONFIRMED` y `AWAITING_CUSTOMER` ocupan **toda la ventana de dos horas** para
  los técnicos asignados. Una propuesta enviada reserva hasta que responda el cliente.
- Cambiar el inicio interno no libera una parte de esa ventana ni permite
  reutilizarla para otra request del mismo técnico y día.
- Comprobar tanto el empalme de ventanas del cliente como el del trabajo interno,
  especialmente cuando un trabajo se extiende a la ventana siguiente.
- Ventanas consecutivas no se empalman por compartir el límite de las 10:00;
  esto no elimina la necesidad de revisar trabajo interno y traslado.
- Un **borrador no enviado** no reserva ni aparece como cita confirmada en Calendar.
- La aceptación conserva la reserva y la convierte en confirmada. El rechazo
  o la expiración liberan inmediatamente la propuesta para preparar otra; no
  cancelan otras citas.

Ejemplo: Jorge tiene una propuesta **08:00–10:00**, con trabajo interno
**09:00–10:00**. Otra request de Jorge ese día no puede guardarse en **08:00–10:00**
por mover su inicio interno a las **08:00**. Se debe elegir otro técnico, día o
ventana viable.

**Corrección verificada en frontend (13 de octubre de 2026):** `proposalDraft.js`
comprueba la ventana completa y el tiempo ocupado por el trabajo interno. La
agenda muestra ambas referencias y el guardado rechaza los conflictos, incluso
si el inicio interno cambia. La regla también se vuelve a validar al guardar.
Si falta una fecha o ventana válida de una cita vigente, no se afirma disponibilidad.
Esto sigue siendo simulación en memoria, no una protección implementada en backend.

## 8. Proposal Workspace y calendario

- Workspace permite **ver** la request y ligarla al borrador/propuesta; no editar
  sus datos originales. Las correcciones previas se realizan en Requests.
- El borrador conserva técnico(s), día, ventana e inicio/fin interno con el mismo
  folio. Volver a validar antes de guardar, usando el estado actual compartido.
- Si hay cambios sin guardar, pedir confirmación antes de cambiar de request,
  cambiar a un filtro que cierre su planificación, salir de la vista o usar Atrás.
  **Keep editing** conserva la selección; **Leave without saving** descarta solo
  cambios actuales y conserva cualquier borrador previamente guardado. No hay
  autoguardado. La recarga/cierre con cambios utiliza el aviso nativo del navegador;
  recargar sigue eliminando toda la memoria de la simulación.
- El catálogo de técnicos del prototipo es independiente del historial de citas:
  conserva únicamente Hilario Najera y Jorge Murillo, ya presentes en los mocks.
  No añadir técnicos, capacidad o puntos de inicio por suposición.
- `technicianIds` contiene la asignación completa de una visita o borrador. Una
  reserva se valida para cada ID, no solo para el técnico principal. Los campos
  singulares de registros anteriores son únicamente compatibilidad de lectura.
  Calendar conserva una sola cita y permite filtrarla por cada integrante asignado.
- Si cambian los datos relevantes o la revisión, señalar que el borrador necesita
  revisión; no presentarlo como vigente automáticamente.
- La vista incorporará trabajos anteriores/posteriores, traslado estimado y
  alternativas ordenadas cuando exista la integración con Google Maps Routes API.
  No simular esos cálculos en el frontend actual.
- Calendar muestra las citas aceptadas por **ventanas de dos horas** en Week y
  Day, no únicamente por el tiempo interno del trabajo.
- Una cita confirmada de cualquier Work type, incluido **Multiple work types**,
  debe aparecer con los filtros iniciales y poder filtrarse por su clasificación.
- No reclasificar arbitrariamente registros antiguos para hacerlos coincidir
  con las nuevas categorías.
- Conservar prioridad y notas editables cuando hay propuesta enviada o cita
  confirmada; bloquear cambios operativos que invaliden su planificación.
  Replanificar requiere un flujo explícito, no editar silenciosamente la cita.
- Una request `COMPLETED` conserva todos sus datos como solo lectura excepto
  **Internal notes**. Su prioridad tampoco se modifica.
- En una request `READY_TO_PROPOSE`, cambiar ubicación, alcance, ítems, duración
  o crew exige nueva revisión. Cambiar solo prioridad o notas no la invalida.
  El bloque 2 limpia `reviewed_by`, `reviewed_at` y `valtrim_items_confirmed` al
  invalidarla. Corregir un contacto sin dejarlo inválido conserva la revisión.
  Las citas en curso también quedan protegidas contra cambios operativos.
- No añadir agendamiento manual independiente desde Calendar que evada Workspace.

## 9. Fuentes, extracción y visualización

- **Visor de originales, punto 5 autorizado el 27 de octubre de 2026:** ampliar
  el diálogo de fuentes existente en View/Edit Request para consultar el correo
  retenido, remitente/destinatarios, asunto y fechas de California, con enlace a
  Outlook cuando exista. Mostrar HTML como texto legible inerte, sin ejecutar
  contenido ni cargar recursos externos. Listar los adjuntos privados mediante
  el RPC existente y solicitar enlaces temporales solo al seleccionar un archivo;
  permitir vista PDF/JPG/JPEG/PNG, apertura, descarga, renovación del acceso y
  reintento de consulta. Un error de permisos/consulta no equivale a una lista
  vacía. Conservar el PDF humano de recuperación como fuente separada del correo
  y sus adjuntos; las correcciones del formulario no alteran originales. Abrir o
  cerrar el visor conserva la captura pendiente y no guarda ni aprueba la request.
  Implementación preparada en frontend, reutilizando los contratos existentes,
  sin migración ni despliegue de funciones nuevos para este punto. La validación
  con originales reales autenticados corresponde al piloto. Validación local:
  445 pruebas frontend aprobadas, incluidas nueve nuevas del visor, lint completo
  aprobado y build generado. Revisión con Playwright en escritorio y móvil de
  390 px, HTML inerte, selección PDF/imagen, errores y reintentos, renovación,
  respuestas tardías, captura sin guardar y PDF de recuperación/manual. Esas
  pruebas de navegador usan fuentes y respuestas simuladas; no certifican el
  piloto autenticado con archivos reales.

- En la captura manual actual, las entradas alternativas son **PDF del correo** o
  **texto pegado del correo**. Ambas siguen el flujo IA → JSON estructurado →
  formulario → revisión humana.
- En la importación automática acordada, el cuerpo del correo y sus imágenes/PDF
  se analizan en conjunto para preparar los datos de la misma request. Conservar
  las fuentes y los resultados para la revisión humana; editar el formulario no
  debe modificar esa referencia. El análisis de imágenes está preparado localmente
  en el bloque 4 de correo; su ejecución automática e integración UI siguen pendientes.
- En cadenas reenviadas, extraer la fecha del mensaje externo original dirigido
  a Valtrim, no la fecha de un reenvío interno. En PDF conservar Order Date y
  Scheduled Date como datos distintos; no sustituirlos por COE, fecha efectiva
  de garantía, finalización o fecha de generación del archivo.
- Mantener From y Subject **opcionales**. No exigir PDF para registrar un servicio
  manual ni duplicar el contenido completo del correo en otro campo obligatorio.
- **Corrección aprobada el 21 de octubre de 2026, preparada y pendiente de desplegar:**
  guardar cualquier From o Subject capturado aunque no exista PDF ni texto del
  correo. Persistirlos en `service_request_sources` como `EMAIL_METADATA`, con
  archivo `NOT_APPLICABLE`, sin cuerpo, extracción ni PDF ficticios. Si ambos
  están vacíos y no hay documento/texto, no crear una fuente. Conservar From y
  Subject tras releer/recargar. No cambiar la fuente ni sus metadatos durante
  edición, ni rellenar registros anteriores con valores supuestos.
- La persistencia inicial del formulario manual admite como máximo **un PDF de
  10 MB** por request. El PDF sigue siendo opcional. Esta es la capacidad inicial
  aprobada el 19 de octubre de 2026, no un límite definitivo para la importación
  automática de correo, cuyo análisis de imágenes y PDF fue confirmado el 20 de
  octubre. El 22 de octubre se confirmaron PDF, JPG/JPEG y PNG, 10 MB por archivo,
  10 archivos incluyendo inline y 50 MB de adjuntos por correo, con rechazo
  completo ante cualquier incumplimiento, según la regla anterior. Ampliar el
  conector requiere evolucionar el almacenamiento y las validaciones, sin
  presentar esa capacidad como disponible hoy ni ampliar el formulario manual
  a múltiples archivos.
- El contrato de extracción contempla propiedad, contactos, documento y múltiples
  trabajos. Distinguir información extraída de sugerencias e inferencias.
- Builder y Project / Job se comparan con alias del catálogo frontend, ignorando
  mayúsculas, acentos, puntuación y espacios. Solo una coincidencia única se
  autocompleta. El Job se busca dentro del Builder identificado y sus coordenadas
  configuradas prevalecen sobre las extraídas; una ausencia o ambigüedad queda
  visible para revisión manual y nunca inventa una ubicación.
- Conservar la fuente original, OCR/resultado y JSON en memoria con la request
  durante la sesión; las correcciones del formulario no modifican esa referencia.
  El bloque 1 también los recupera de Supabase tras recargar, incluyendo los
  metadatos del PDF privado; su acceso usa la Edge Function ya existente.
- Si falla el PDF después de crear, conservar la request y el folio, informar el
  éxito parcial y permitir reintentar con la misma `submission_key`. El formulario
  mantiene la captura enviada bloqueada mientras se completa el reintento. El
  archivo original también queda disponible para reintentar desde el visor durante
  la sesión si se cierra el formulario. Recargar pierde esa copia local: el estado
  PENDING/FAILED y la extracción permanecen visibles; recuperar un archivo perdido
  o sustituirlo desde edición queda fuera de este bloque.
- Review permite comparar con el documento real. Si no existe fuente disponible,
  informar esa ausencia; no mostrar una representación provisional como PDF real.
- PDF/texto se cargan al crear, no al editar. Si se guarda sin fuente, avisar que
  la información faltante se completará manualmente en edición.
  El RPC del bloque 2 no acepta cambios de fuente ni de sus metadatos originales;
  From y Subject se muestran como referencia de solo lectura en edición.
- Reset a datos extraídos tiene confirmación, representación de carga y Deshacer.
  La extensión de esa protección a Replace PDF y reanálisis fue **pospuesta por
  el usuario**: no marcarla como resuelta ni implementarla sin retomar ese pendiente.
- La fuente y el formulario no deben aparentar correspondencia si falla una nueva
  extracción o cambia el texto analizado. Su protección sigue pendiente; la
  solución propuesta es mantener la fuente anterior hasta el éxito y señalar
  análisis desactualizado, no asumir que ya está implementada.
- Los valores autocompletados deben verse sin enfocar el campo: las etiquetas
  no pueden superponerse al contenido.
- Lista de ítems: tabla compacta en escritorio y tarjetas en móvil, sin scroll
  horizontal. Mantener el mecanismo compacto para listas largas.
- Botón para añadir ítem debajo de la lista, estilo de **Add another customer**,
  ancho según texto y separación respecto de los campos siguientes.
- Mostrar carga, resultado, errores y ausencia de datos con mensajes claros;
  no afirmar éxito antes de terminar una operación.

## 10. Comunicación y siguientes vistas

- La propuesta se enviará por correo mediante SMTP de la empresa, en su etapa
  correspondiente. Preparar destinatario, asunto, vista previa y confirmación.
- El cliente acepta la ventana o rechaza y solicita otra fecha. También puede
  indicar **No puedo determinado día**, **Necesito que me contacten** y un comentario.
- **Necesito que me contacten** crea seguimiento `NEEDS_CONTACT`; no muestra un
  número público ni confirma otra fecha. Anelda llama al cliente para acordarla.
- La fecha solicitada vuelve a revisión de Valtrim, no se convierte directamente
  en una cita. Si no hay una opción conveniente, se contacta al cliente.
- Abrir el enlace no lo consume. Después de responder debe seguir mostrando el
  estado actual, sin permitir aceptar otra vez una propuesta ya sustituida.
- Conservar la información original del correo para entregarla al equipo de campo.
- Orden del plan: Review Request → Proposal Workspace → Proposal Preview & Send
  → página del cliente → Reproposal → Completion → configuración operativa.
- Reproposal reutiliza Workspace/detalle con respuesta e historial; no necesita
  otra página completa. El visor de fuente permanece como diálogo.
- Al sustituir una propuesta, la anterior se marca como **Previous proposal** y
  no puede aceptarse ni editarse. Si se necesita agregar información, utilizar un
  único campo editable **Final notes**, disponible solo para Anelda Calvillo, sin
  modificar lo que se envió al cliente.
- La simulación frontend debe cubrir envío exitoso, error y reintento; recordatorio
  exitoso o fallido; aceptación; rechazo; solicitud de contacto; enlace sustituido,
  duplicado o expirado. No ejecutar SMTP real durante esta etapa.
- Eliminar Additional visit y cualquier creación de otra cita o visita. El flujo
  operativo es: `CONFIRMED` significa aceptado y pendiente por realizar; al iniciar
  automáticamente cualquiera de las ventanas 08:00–10:00, 10:00–12:00 o
  12:00–14:00 cambia a `WORKING`; al finalizar la ventana asignada cambia
  automáticamente a `COMPLETED`.
- Una request `COMPLETED` permite modificar únicamente notas internas.
- Anelda Calvillo y cualquier usuario con rol Customer Service pueden revisar y
  aprobar la nueva propuesta.

## 11. Pendientes y decisiones abiertas

Esta lista registra lo que no debe confundirse con una regla ya implementada
o con una decisión cerrada. No reemplaza un diagnóstico completo del código.

1. Integrar Google Maps Routes API en una etapa futura de backend/BD y definir
   con sus resultados la compatibilidad geográfica de días. No forzar una
   simulación frontend del cálculo.
2. Resolver correspondencia de fuente/análisis/formulario. La confirmación y
   Deshacer para reemplazo/reanálisis permanecen pospuestos.
3. Definir las reglas de cancelación/cierre e ítems pendientes.
4. Definir configuración SMTP.
   El proveedor del buzón de entrada fue confirmado como **Microsoft 365 /
   Exchange Online** el 20 de octubre de 2026. Esa recepción se planifica mediante
   Microsoft Graph, por separado de SMTP; aún faltan buzón, carpeta y configuración
   de acceso. Ver [plan de entrada Microsoft 365](customer-service-microsoft-365-intake.md).
5. Lectura, creación, edición y aprobación de requests ya están desplegadas y
   verificadas por sus suites relacionadas. Las dos requests antiguas de prueba
   sin Job fueron eliminadas mediante IDs exactos y sin respaldo por instrucción
   explícita del usuario. Quedan por revisar los fallos preexistentes de la
   regresión global, detallados en la guía del bloque 4. No confundir ejecutar
   toda la suite con que todos sus casos hayan pasado. Borradores, propuestas,
   reservas y programación del flujo nuevo conservan su alcance en memoria.
6. La migración `20261019130000_customer_service_identifiers_deadlines_coordinates.sql`
   alinea folios y `due_on` con el quinto día hábil posterior a **Reported on**,
   sin contar la fecha reportada. Las pruebas remotas de línea base de esquema,
   creación y PDF pasaron el 20 de octubre de 2026; esto no equivale a desplegar
   automáticamente las nuevas migraciones de cada bloque.
7. Implementar la importación Microsoft 365 con análisis del correo completo,
   imágenes y PDF, creación NEEDS_REVIEW y aprobación humana. Implementar los
   formatos, límites y rechazo completo de adjuntos confirmados el 22 de octubre,
   junto con Correos con problemas y recuperación PDF/manual. Concretar el manejo
   operativo de fuentes ilegibles y fallos de infraestructura. El guardado
   estructurado incompleto ya está preparado en el bloque 2 y sus dos suites
   remotas fueron aprobadas según el resultado compartido por el usuario; falta
   conectarlo al procesamiento del correo. El flujo confirmado no
   autoriza inventar datos ni eliminar validaciones de aprobación. El buzón final
   será de una trabajadora; se contempla un piloto con el correo del usuario,
   todavía sin dirección ni carpeta configuradas.

**Cierre frontend de 2A, verificado el 13 de octubre de 2026:** aviso de cambios
sin guardar, reloj operativo de California y catálogo/asignación múltiple de técnicos.
Son comportamiento y datos en memoria; no certifican reservas persistidas ni
disponibilidad real. Los puntos de salida y conveniencia de rutas siguen en 2B.

## 12. Acuerdos anteriores sustituidos

No volver a introducir como requisitos:

- jornada hasta las 17:00: se corrigió a **15:30**;
- duración global de 60 minutos: depende del servicio y de su revisión;
- buffer fijo de 30–45 minutos: fue descartado;
- una request por ítem: una request admite varios ítems;
- restricciones del cliente capturadas antes de enviar propuesta: corresponden
  a su respuesta, no a New Request;
- tratar 12:00–14:00 como ventana excepcional o deshabilitada: ahora está activa
  con las mismas reglas que las otras ventanas;
- bloquear una propuesta por no encontrar otro trabajo cercano: la ausencia de
  coincidencias solo elimina la sugerencia; Anelda conserva la decisión;
- inventar distancias o regiones para simular Google Maps en frontend;
- crear visitas adicionales: el flujo termina en `WORKING` y `COMPLETED`;
- editar operativamente la request desde Workspace o una cita confirmada para
  evadir la planificación;
- considerar solo horario interno libre cuando la ventana completa ya está reservada.

## 13. Validación y mantenimiento

- Al modificar Customer Service, identificar las reglas afectadas y probar su
  comportamiento, no solo la existencia de un componente con el nombre esperado.
- Para programación, probar ventana completa, horarios internos, integrantes,
  propuestas pendientes, citas confirmadas, límites de jornada y excepciones.
- Para captura, probar guardado incompleto, aprobación, múltiples ítems,
  duración manual, ubicación alternativa y visualización de datos autocompletados.
- Verificar que el modo frontend no envíe correos, no cree citas antes de aceptar
  ni añada persistencia sin autorización.
- Registrar una nueva decisión aquí y ajustar documentación/pruebas relacionadas.
  No cambiar reglas aprobadas solo para hacer pasar una prueba.
- Los problemas conocidos permanecen pendientes hasta verificar su corrección;
  documentar una regla no significa que el código ya la cumple.
