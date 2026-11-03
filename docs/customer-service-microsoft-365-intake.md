# Customer Service — entrada desde Microsoft 365

**Automatización aprobada y preparada localmente el 30 de octubre de 2026:**
consulta cada minuto, worker solo con trabajo elegible y revisión independiente
de IDs/enlaces cada 15 minutos. El dispatcher conserva esperas y checkpoints,
evita llamadas programadas simultáneas y usa firmas temporales de un solo uso.
Requests muestra salud/errores y actualiza la colección solo cuando cambia.
La discrepancia de carpeta se señala para revisión, no se reimporta de oficio.
Migración nueva, tres despliegues y activación mediante Vault quedan pendientes
de ejecución por el usuario; se instala pausado. Continúan NEEDS_REVIEW,
aprobación humana, PDF privados e imágenes solo en memoria. Ver
[guía de implementación y activación](customer-service-email-automation.md).

**Actualización de planificación, preparada localmente el 29 de octubre de 2026:**
el importador comparte con el frontend las reglas de clasificación global,
duración y crew por Service task y cantidad de ítems descritos incluidos. Conserva
el análisis original, reanuda desde fuentes válidas y no modifica requests ya
procesadas. El formulario propone faltantes al editar NEEDS_REVIEW, conserva
valores manuales y exige guardar antes de persistir. No requiere migración;
los despliegues del usuario se confirmaron con worker ACTIVE v15 y retry ACTIVE
v11, código idéntico al local y arranque HTTP sin procesar correos. La publicación
del frontend no se verificó. Ver
[reglas compartidas y comandos](customer-service-planning-rules-2026-10-29.md).

El usuario confirmó **Microsoft 365 / Exchange Online** el 20 de octubre de 2026.
**Cambio aprobado el 28 de octubre, implementación por bloques:** analizar las
imágenes/fotografías en memoria y guardar su información extraída, incluido texto
cuando exista, sin retener los archivos en Storage ni binarios/base64 en BD,
checkpoints o logs. El flujo descrito más abajo aún corresponde al almacenamiento
histórico de imágenes; la regla vigente está en
[reglas funcionales](customer-service-business-rules.md). Los PDF conservan su
política actual. Los bloques deben adaptar conjuntamente conector, contrato SQL,
worker/reintentos y visor: omitir únicamente upload no es compatible con la
implementación existente. Las siete imágenes históricas de CS-1876 no se borraron.

El **bloque 1 de no retención** prepara el contrato SQL V2, sin adaptar todavía
conector, worker o visor al cerrar aquel bloque. La aplicación remota de la
migración `20261028180000` se comprobó el 28 de octubre. Quince
suites SQL distintas pasaron en preview remoto con ROLLBACK.
V1 conserva los originales existentes; V2 fija imágenes GRAPH_ONLY sin archivos
y mantiene PDF STORED. El worker actual no reclama fuentes V2 pendientes.
No requiere desplegar Edge Functions ni activa sincronización periódica.
Ver [contrato, pruebas y comandos](customer-service-image-no-retention-block-1-testing.md).

El **bloque 2 de no retención** está preparado localmente: el conector fija
fuentes nuevas V2 sin subir imágenes, mantiene validación completa y sube solo
PDF. La migración `20261028200000` restringe las nuevas cargas del bucket a PDF
y añade recuperación V2 con versión/auditoría; conserva originales históricos y
los pendientes V1 sin convertirlos. La migración se comprobó aplicada al iniciar
el bloque 3; el despliegue de `customer-service-email-sync` no se verificó en esa
entrega. Pasaron 86 pruebas del conector, 59
regresiones, tipos/lint y trece suites SQL con ROLLBACK. No se ejecutó Graph real,
IA ni cron. Las fuentes V2 quedan en cola hasta adaptar el worker en el bloque 3.
Ver [alcance, pruebas y comandos](customer-service-image-no-retention-block-2-testing.md).

El **bloque 3 de no retención** prepara el worker y el reintento humano para V2.
Recupera imágenes pendientes de la conexión/mensaje fijados, verifica el original
y analiza en memoria; guarda texto pertinente/hechos y diagnósticos mínimos.
Conserva los PDF y las imágenes históricas V1 en su tratamiento actual. Los
análisis válidos sobreviven a continuaciones/fallos sin repetir inferencias ni
descargas de imágenes terminadas. Retry-After puede ampliar la espera habitual;
una continuación no consume el presupuesto de fallos. No se crea una request
parcial ante un fallo técnico y la request completa sigue en NEEDS_REVIEW.
La revisión posterior del 28 de octubre confirmó la migración `20261028220000`
aplicada y sync ACTIVE v9, worker ACTIVE v10 y retry ACTIVE v6. Se contrastaron
código desplegado, definiciones SQL y arranque HTTP, sin procesar correos. Ver
[confirmación de despliegues](customer-service-image-deployment-verification-2026-10-28.md).
El visor se adapta en el bloque 4; la entrega del bloque 3 no activó cron ni limpió
archivos históricos. Ver [pruebas y comandos](customer-service-image-no-retention-block-3-testing.md).

El **bloque 4 de no retención** está implementado localmente: el visor compartido
consulta manifiesto y análisis V1/V2, muestra texto/hechos y advertencias por
adjunto y conserva el enlace a Outlook. Las imágenes nuevas no solicitan URLs,
vistas previas ni descargas de archivos; los PDF mantienen su tratamiento actual.
El usuario indicó que eliminó las imágenes históricas en Storage: el visor
conserva la extracción y muestra errores cuando un original no se puede abrir,
sin restaurarlo ni limpiar sus referencias. Pasaron 453 pruebas frontend,
lint/build y revisión Playwright con datos simulados de escritorio/móvil. No
requiere migración ni redesplegar funciones. Publicación frontend y piloto real
integral pendientes; sin activar cron. Ver
[validación del bloque 4](customer-service-image-no-retention-block-4-testing.md).

El **piloto real V2 del 29 de octubre** importó un solo mensaje y analizó su
cuerpo y cuatro imágenes inline sin guardar archivos de imagen. No era un caso
estrictamente sin adjuntos. El proveedor terminó las cinco fuentes correctamente;
la importación quedó NEEDS_ATTENTION porque el correo enumera tres propietarios
sin definir un principal único. No se creó request ni se consumió folio. Repetir
worker/sync no repitió inferencia ni creó otra importación; la BD confirmó cero
archivos/vínculos/objetos nuevos y ausencia de binarios en el registro V2. No se
alteraron reglas, claves ni programación periódica. Ver
[diagnóstico y evidencias](customer-service-email-pilot-2026-10-29.md).

**Corrección aprobada después de ese diagnóstico, el 29 de octubre:** usar el
primer propietario del correo como principal. Conservar todos en la extracción
para revisión, manteniendo un principal y como máximo un adicional en el
formulario. La presencia de tres propietarios deja de bloquear por sí sola el
alta NEEDS_REVIEW; no se toma al remitente ni al representante del constructor.
Worker y reintento comparten esta selección y respetan el orden de los contactos
del cuerpo antes de los adjuntos. La misma importación puede retomarse con sus
análisis válidos, sin volver a descargar ni analizar las imágenes. No requiere
migración ni modificar el conector de sincronización, y no activa cron.

**Resultado de esa corrección:** se creó la request **974 / CS-1974** en
NEEDS_REVIEW y se confirmó el mismo ID al repetir worker. Se preservaron los tres
propietarios, un ítem, cero archivos/vínculos/objetos nuevos y ausencia de binarios.
Se corrigió asimismo la comparación de offsets de checkpoints jsonb; su orden de
claves causó un reanálisis del cuerpo durante la recuperación. El código final
reutiliza los cinco checkpoints reales en memoria sin llamadas al proveedor ni
descargas. Worker ACTIVE v12, retry ACTIVE v8; sync permanece ACTIVE v9. Pasaron
74 pruebas de análisis, 44 de worker, tipos y lint. No requiere migración; la
revisión/aprobación humana y los demás escenarios del piloto siguen pendientes.

**Ampliación posterior del mismo día:** hasta tres customers por request,
primero principal y dos adicionales, con sus propios teléfonos. Añadir +1 a diez
dígitos únicamente con dirección fuente de Estados Unidos (estado y ZIP
reconocibles); conservar originales y advertir la normalización. La migración
`20261029190000` ya está aplicada y CS-1974 ya contiene los tres nombres y
teléfonos, sin nueva IA, cambios de fuente/análisis ni duplicados. El formulario
se actualizó localmente, sin publicar el sitio. Ver
[implementación y validación](customer-service-three-customers-2026-10-29.md).

El conector se prepara sobre Microsoft Graph. El piloto usará el buzón propio
`victor@valtriminc.com` y la carpeta raíz `Customer Service`. El 27 de octubre se
comprobó autenticación de aplicación y lectura de metadatos de esa carpeta, sin
consultar mensajes. Este documento no acredita recepción automática activa.

El **bloque 7.3** prepara configuración/avance privados y adaptador del backend:
[contrato, validación e instalación](customer-service-email-import-block-7-3-testing.md).
El esquema ya está disponible en remoto y la conexión real registrada es
`779ebb10-fc40-4a30-9a72-639123cbb057`, con `BASELINE_ONLY`, habilitada e inicializada. La
identidad del buzón es el UUID de usuario `ec1afdfd-199f-4fd4-98e7-069fb4dd909e`,
proporcionado por el usuario y verificado mediante la misma carpeta Graph por
UUID y por dirección. La consulta previa del perfil devolvió 403, pero no fue
necesario ampliar permisos ni utilizar el Object ID de la aplicación.
App-only no requiere URL de redirección. El bloque 7.4 prepara el conector;
no se instala una alternativa delegada ni un callback por suposición.

El 27 de octubre se implementó `customer-service-email-sync` y su cliente Graph,
con pruebas simuladas y validación SQL remota mediante ROLLBACK. Conserva una
página completa antes de avanzar y entrega las fuentes AVAILABLE a la cola del
worker existente. El worker se invoca aparte; no se llama a Mistral desde la
sincronización. La migración de espera durable y la corrección OData posterior
`20261027200000` están aplicadas. El conector corregido está ACTIVE v7 y el
reintento de línea base terminó con ROUND_COMPLETE y DELTA, sin errores ni reserva,
con cero importaciones/requests del buzón. No se ejecutó el worker ni IA.
El secreto del endpoint ya se generó, guardó y verificó en Supabase Secrets sin
copiar su valor al repositorio. El piloto posterior dejó una importación con
ATTACHMENT_SIZE al comparar metadatos con bytes crudos. El bloque 1 corrigió la
descarga y los límites por bytes reales; una validación de solo lectura aceptó
sus siete imágenes (cuatro inline, 8.901.705 bytes) sin persistencia ni IA. Se
mantienen 10 MB por archivo, 10 adjuntos, 50 MB totales, integridad y validación
del conjunto completo. El bloque 1 no requirió migración. Después, el bloque 2
añadió y aplicó `20261027210000_customer_service_graph_source_recovery.sql` para
recuperar de forma explícita y auditada rechazos de tamaño. Revalida todo antes
de fijar/almacenar, conserva el mismo importId y el error anterior, y no cambia el
cursor ni ejecuta IA. También normaliza el MIME de subida al tipo ya validado,
sin cambiar bytes. La recuperación real dejó ese correo AVAILABLE/PENDING con
siete archivos, una auditoría y ningún duplicado ni request en esa etapa. El 28 de
octubre se inició el bloque 3: se autorizó/configuró un nuevo secreto del worker y
un reintento auditado terminó PROCESSED, con una única request **CS-1876 / 876**
en NEEDS_REVIEW. Texto y siete imágenes fueron analizados; repetir la llamada
devolvió la misma request sin otra inferencia. Worker ACTIVE v9, sin migración
nueva. Job/work category y aprobación permanecen para revisión humana. La
verificación visual del visor está pendiente de que el usuario inicie sesión en
la app local; no certificarla solo por las pruebas backend. La programación
periódica continúa pendiente. Ver
[pruebas del conector 7.4](customer-service-email-import-block-7-4-testing.md).

El flujo fue precisado por el usuario: analizar el correo completo y también
las imágenes o PDF que contenga; registrar la request en BD en NEEDS_REVIEW;
una persona revisa, edita y aprueba READY_TO_PROPOSE. El buzón final será de una
trabajadora; el primer piloto está confirmado con el correo del usuario.

## Diseño del primer conector

Un proceso del servidor consultará los cambios de una carpeta elegida, guardará
el mensaje como importación y lo procesará con el contrato de captura existente.
La aplicación mostrará después la request NEEDS_REVIEW para abrirla, editarla y
aprobarla manualmente. La IA nunca llamará al RPC de aprobación.

Para comenzar el prototipo se propone probar primero el procesador con correos
de muestra, persistencia real y revisión en la app. Después se conectará Graph
al mismo procesador. Así se pueden validar extracción, guardado incompleto,
recarga y aprobación sin depender inicialmente de configurar el buzón de prueba.
Los bloques de registro, guardado parcial, fuentes y análisis ya fueron
autorizados por separado. El worker ya existe y el conector está preparado en
código y desplegado; el piloto y su activación aún siguen pendientes.

Se propone sincronización incremental cada 1–2 minutos como primer incremento.
La API de [cambios de mensajes por carpeta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
permite recuperar altas, cambios y salidas sin volver a descargar todo el buzón.
La frecuencia es una propuesta técnica, pendiente de activación.

Usar `GET /users/{mailboxId}/mailFolders/{folderId}/messages/delta`, conservando
la URL completa de `@odata.nextLink` durante la paginación y `@odata.deltaLink`
al terminar una ronda. Persistir las importaciones antes de avanzar el cursor.
Repetir una página después de un fallo debe reutilizar sus registros y claves.

Enviar `Prefer: IdType="ImmutableId"` en las operaciones de mensajes. Esos IDs
son sensibles a mayúsculas y permanecen estables al mover el mensaje entre
carpetas del mismo buzón; no cubren traslado a otro buzón o exportación y
reimportación. Ver [identificadores inmutables](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).

El índice único propuesto utiliza tenant, buzón e ID inmutable. Guardar también
`internetMessageId` y `conversationId` como contexto; una conversación por sí
sola no demuestra que sus mensajes correspondan a una misma nueva request.
No filtrar por fecha de envío al detectar entradas: un correo antiguo movido a
la carpeta hoy también debe poder procesarse. Moverlo fuera de la carpeta no
autoriza borrar la request que ya se creó.

La política confirmada es `BASELINE_ONLY`: la primera ronda completa establece
una línea base sin importar su contenido histórico. Se importarán las entradas
posteriores a completar esa inicialización. Registrar la conexión deshabilitada
no inicia la primera ronda ni fija todavía el corte. No cambiar a IMPORT_EXISTING
ni reiniciar un cursor como alternativa sin autorización.

## Contenido y adjuntos

Recuperar remitente, destinatarios, asunto, fecha original de envío, recepción e
identidad del mensaje. Para el cuerpo normalizado, el endpoint
[Get message](https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0)
admite `Prefer: outlook.body-content-type="text"`. Mantener esa fuente separada
del resultado extraído y de las correcciones posteriores del formulario.

[List attachments](https://learn.microsoft.com/en-us/graph/api/message-list-attachments?view=graph-rest-1.0)
permite recuperar los adjuntos del mensaje. El alcance del conector incluye
analizar imágenes y PDF junto con el correo. La capacidad ya implementada de un
PDF de hasta 10 MB pertenece al formulario manual. Para la entrada automática,
el 22 de octubre se confirmaron **PDF, JPG/JPEG y PNG**, **10 MB por archivo**,
**10 archivos por correo incluyendo imágenes inline** y **50 MB de adjuntos en
total por correo**. Ampliar el almacenamiento y validar el conjunto completo
antes de persistir archivos o crear la request. Si un archivo incumple, detener
todo ese correo sin request ni adjuntos guardados parcialmente; conservar el
registro técnico mínimo NEEDS_ATTENTION con identidad estable, motivo y enlace
al correo original. No seleccionar solo los archivos válidos ni descartar
contenido silenciosamente. Vínculos a documentos y archivos protegidos requieren
concretar su manejo operativo, sin tratarlos automáticamente como contenido leído.

El panel futuro **Correos con problemas**, dentro de Requests, permitirá abrir
el formulario existente para subir un PDF válido y extraer semiautomáticamente;
si falla, completar manualmente. Guardar vincula una sola request NEEDS_REVIEW a
la misma importación, sin duplicados ni aprobación automática. Estos contratos
están confirmados. El usuario aplicó/desplegó el bloque 3; se verificaron inventario,
autenticación/preflight y ocho suites SQL remotas. La transferencia binaria real
no se probó. Panel/recuperación siguen en la integración UI posterior. El futuro
conector registra primero metadatos
mínimos con el `webLink` proporcionado por Graph; el cuerpo se conserva solo tras
validar el conjunto. Debe entregar todos los adjuntos, incluidos inline, a
`persistCustomerServiceEmailSource` y comprobar `sourceStatus: AVAILABLE` antes
del análisis/guardado, sin omitir archivos para sortear un rechazo.
Los correos posteriores relativos a una request existente siguen pendientes de
decisión según el [diagnóstico](customer-service-email-import-assessment.md).

Mistral ofrece [OCR de PDF e imágenes](https://docs.mistral.ai/studio/document-processing/basic_ocr)
para texto y estructura documental, y [modelos con visión](https://docs.mistral.ai/studio/conversations/vision)
para contenido visual. La selección técnica debe cubrir también fotografías
sin texto; leer únicamente caracteres no equivale a analizar una fotografía.
El bloque 4 prepara localmente la combinación del cuerpo, documentos, imágenes y
campos de formularios PDF en una propuesta de datos, manteniendo procedencia,
alternativas contradictorias y errores por fuente. El usuario aplicó su migración;
nueve suites relacionadas pasaron en remoto. El bloque 5 prepara ahora un worker
local con reservas, avances y guardado, sin desplegar/activar ni conectar Graph. Ver
[pruebas y activación del bloque 4 de correo](customer-service-email-import-block-4-testing.md).
La operación del procesador se detalla en el
[bloque 5 de correo](customer-service-email-import-block-5-testing.md).
La IA no confirma por sí sola proveedor, alcance técnico ni aprobación.

El registro inicial de importación permite retener y recuperar el trabajo durante
el análisis. Es un dato técnico del procesamiento, no otra fase de la request.
La request de negocio resultante siempre se registra en NEEDS_REVIEW y se abre
después en la revisión existente. El visto bueno usa el RPC humano actual, no un
cambio libre del estado desde el importador ni desde el guardado de edición.
La decisión del 21 de octubre permite crear esa request aun si faltan campos de
negocio, siempre con propietario y un ítem descrito: mostrar lo pendiente y
permitir completarlo durante revisión. El bloque 2 ya preparó el guardado
estructurado y la revisión parcial; el usuario compartió dos suites remotas
aprobadas. Falta conectarlo al procesamiento del correo, manteniendo autorización
y validaciones completas de READY_TO_PROPOSE. Un error técnico de análisis,
un adjunto no admitido y una extracción válida con campos ausentes son casos
diferentes.

## Acceso propuesto

Para operar sin una sesión de la coordinadora se propone una aplicación de
Microsoft Entra con acceso de aplicación limitado al buzón elegido.
`Mail.Read` permite recuperar el cuerpo y los adjuntos; el permiso básico no
incluye estos últimos. [RBAC para aplicaciones de Exchange Online](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)
permite asignar acceso por ámbito de buzones. El ámbito no es una restricción
por carpeta: el conector debe limitar operativamente su lectura a la elegida.

Al configurar RBAC, revisar las concesiones existentes de Entra: ambos mecanismos
son aditivos y una concesión global paralela puede ampliar el acceso efectivo.
La configuración requiere intervención de un administrador de Microsoft 365.
Las credenciales se guardaron y verificaron el 26 de octubre en Supabase Secrets
como `MS365_TENANT_ID`, `MS365_CLIENT_ID` y `MS365_CLIENT_SECRET`; no forman parte
del frontend ni de la tabla privada de conexiones, y no se solicitan en el chat.

Para el primer piloto se propone lectura únicamente y seguimiento de procesado
en la aplicación. Mover correos, etiquetarlos o marcarlos como leídos después de
importar queda pendiente de decisión. Si se desea modificar el buzón, revisar
entonces la necesidad de `Mail.ReadWrite`; no se necesita `Mail.Send` para recibir.

## Información pendiente

- Preparar y autorizar el piloto antes de habilitar la
  conexión ya registrada. UUID, dirección de prueba, carpeta y `BASELINE_ONLY`
  están confirmados y el secreto del endpoint está configurado; la conexión
  permanece deshabilitada y sin inicializar.
- Administrador que puede registrar/configurar la aplicación y su ámbito.
- Coordinadora asignada a las requests creadas por el proceso.
- Tratamiento de respuestas posteriores. El guardado estructurado incompleto ya
  está preparado en el bloque 2; falta la entrada y el procesamiento automáticos.
- Manejo operativo de fuentes ilegibles y fallos de infraestructura; implementar
  los límites, rechazo completo y recuperación PDF/manual ya confirmados.
- Acción deseada sobre el correo una vez procesado.

La [secuencia ajustada](customer-service-email-import-assessment.md) conserva
los bloques de registro de importaciones, procesamiento conjunto y piloto. El
bloque de recuperación de PDF ya está preparado localmente y documentado en
[pruebas del bloque 5](customer-service-block-5-testing.md).
