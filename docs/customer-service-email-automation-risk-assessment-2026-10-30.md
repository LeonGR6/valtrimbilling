# Consulta automática de Customer Service: función, riesgos y controles

Evaluación del 30 de octubre de 2026. Alcance: consulta de Outlook cada minuto,
preparación de fuentes, análisis, creación de requests y consulta en la app.
Este informe contiene propuestas, no reglas nuevas aprobadas ni controles ya
instalados. No se activó automatización ni se modificó código de producción.

**Actualización posterior:** el usuario autorizó la implementación de consulta
cada minuto, worker condicionado a trabajo elegible y comprobación de carpeta
cada 15 minutos. Esos controles, firmas temporales, pausa y resumen de salud
quedaron preparados localmente; no están desplegados ni activos. Los demás
controles propuestos en este informe no se consideran resueltos por ese cambio.
Ver [alcance implementado, límites y activación](customer-service-email-automation.md).

## Evaluación general

Menos de diez correos al día es un volumen pequeño para la arquitectura existente.
Eso reduce la presión habitual de la cola, pero no evita errores de detección,
credenciales, archivos, proveedores, programación o interpretación. Un solo
correo grande o una ejecución que se repita sin avanzar puede causar problemas.
La cantidad diaria tampoco limita el tamaño de los adjuntos, las páginas PDF ni
el historial que la aplicación acumula y consulta.

Los dos casos reales crearon CS-2022 y CS-2023, ambos NEEDS_REVIEW, con teléfonos
y planificación guardados. El usuario indicó que, tras revisarlos, aparentemente
están bien. Los replays del worker devolvieron las mismas requests. Esto no
equivale a aprobación formal ni certifica todos los formatos y fallos posibles.

CS-2023 necesitó recuperación selectiva manual: la lectura directa de Graph
encontró el mensaje y sus siete imágenes, pero las rondas incrementales no lo
entregaron. Ocurrió al reimportar un mensaje histórico después de borrar su
registro en Supabase. No se ha determinado la causa ni demostrado que afecte a
correos realmente nuevos. No corresponde atribuirlo al volumen o estimar una
tasa de fallo a partir de dos pruebas.

## Función completa

1. Un programador del servidor invoca `customer-service-email-sync`.
2. La función valida su secreto, activación, conexión y reserva. Consulta una
   página delta de la carpeta exacta, con IDs inmutables, y conserva continuaciones.
3. Registra cada mensaje por tenant, buzón e ID. Valida el cuerpo y el conjunto
   completo de adjuntos. Las imágenes se manejan en memoria; los PDF conservan
   su almacenamiento privado. Publica el manifiesto V2 y la fuente disponible.
4. Otra ejecución invoca `customer-service-email-worker` sólo cuando hay trabajo
   elegible. El worker toma una reserva y analiza el cuerpo, las imágenes y los
   PDF; guarda avances válidos para continuaciones y reintentos.
5. Guarda y vincula una sola request NEEDS_REVIEW. Si falta el mínimo de propietario
   y trabajo descrito o falla una fuente, puede quedar una importación con problemas
   sin request. Otros campos incompletos se revisan en la request creada.
6. La app muestra pendientes y evidencia. Una persona corrige y aprueba mediante
   el flujo existente. Esta automatización no envía propuestas ni confirma citas.

El código actual atiende una página por llamada de sync y un correo por llamada
del worker. Una ejecución que cede trabajo necesita otra invocación: no se
despierta sola. Consultar cada minuto no significa terminar cada análisis en un
minuto, especialmente si coinciden varios correos.

## Volumen, llamadas y crecimiento medido

La consulta vacía cada minuto durante 24 horas produce 1.440 invocaciones de sync
al día. Invocar además el worker cada minuto, incluso sin pendientes, añadiría
otras 1.440. Es un cálculo del esquema propuesto, no consumo actual. Paginación,
reintentos y continuaciones pueden añadir trabajo. El cliente Graph renueva su
autenticación en cada nueva instancia de la ejecución; la caché actual del token
es interna a esa instancia, no una caché persistente entre invocaciones.

Recomendación: mantener la consulta al minuto y evitar invocar el worker cuando
no exista trabajo elegible. Revisar operaciones y consumo de IA por fuente,
página y tokens: diez correos no equivalen a diez llamadas al modelo. Las firmas
inline también se analizan bajo la regla actual y cuentan como adjuntos.

Se midieron los campos JSON de las dos importaciones mediante `octet_length`,
sin consultar o exportar sus datos personales:

| Caso | Imágenes | Bytes originales de imagen | JSON conservado |
| --- | ---: | ---: | ---: |
| CS-2022 | 4 | 41.118 | 96.123 bytes |
| CS-2023 | 7 | 8.901.705 | 98.625 bytes |

Es tamaño lógico de cuerpo/manifiesto/referencias/análisis/checkpoints/intake,
no espacio físico de PostgreSQL. No incluye tablas relacionadas, auditoría,
índices, almacenamiento PDF ni datos de otros módulos. A diez correos diarios,
300 correos similares en un mes de 30 días serían unos **29 MB de esos JSON**.
No es una garantía: cadenas HTML largas, OCR y documentos distintos pueden ocupar
mucho más. Hay que medir, no extrapolar indefinidamente desde dos casos.

Se confirmó cero registros de imagen y ningún objeto nuevo de Storage durante
las pruebas. Los originales siguen ocupando espacio en Microsoft 365; los PDF
continúan ocupando Storage. El registro técnico y la evidencia textual también
crecen aunque no se guarden fotos en Supabase.

## Riesgos y estado real de sus controles

### 1. Mensaje presente que no aparece en delta — prioridad alta

Ya se observó en la reimportación del segundo correo. Una respuesta vacía y
correcta no prueba que no haya mensajes sin registrar. Microsoft documenta
demoras de propagación y replays; el cursor de Outlook tampoco tiene una duración
máxima fija garantizada. Eso describe posibilidades, no demuestra la causa de
nuestro caso. [Documentación de delta](https://learn.microsoft.com/en-us/graph/delta-query-overview).

Falta un control independiente que compare periódicamente los IDs actuales de
la carpeta con los importados y los excluidos por la línea base. Propuesta inicial:
comparación de metadatos cada 15 minutos y aviso de diferencias, con recuperación
selectiva auditada. No descargar imágenes ni llamar a IA durante esa comparación.
No importar indiscriminadamente diferencias históricas: en la carpeta se observó
un tercer mensaje ajeno al piloto, que se dejó intacto. Revisar el inventario al
activar y no usar sólo la fecha original de recepción para decidir pertenencia.

### 2. Cursor vencido o reinicialización incorrecta — alta

Existe bloqueo explícito por CURSOR_EXPIRED y se conserva el avance. Falta una
operación de reconciliación controlada para uso cotidiano. Reiniciar el cursor,
borrar el historial o cambiar la línea base puede excluir mensajes o incorporar
históricos inesperados. Mantener la política BASELINE_ONLY y no resolver una
respuesta vacía mediante un reset automático.

### 3. Buzón, carpeta, acceso o secreto incorrectos — alta

Existe identidad fija de tenant/buzón/carpeta, autenticación y errores sanitizados.
Eliminar y recrear una carpeta con el mismo nombre no conserva necesariamente su
identidad configurada. Expirar o revocar credenciales también detiene la lectura.
Añadir aviso operativo, verificación de configuración y procedimiento de rotación.
El programador debe usar los encabezados secretos propios de sync/worker: copiar
sin adaptar un ejemplo genérico de autenticación puede producir respuestas 401.

### 4. Programador aparentemente exitoso, función fallida — alta

El envío HTTP encolado, el HTTP recibido y el resultado del trabajo son tres cosas
distintas. Sync puede devolver HTTP 200 con estados FAILED, UNCONFIRMED o
NEEDS_RECONCILIATION. Una ejecución SQL correcta tampoco demuestra que el worker
haya creado una request. Falta observar las tres capas, la última ronda correcta,
la cola y los errores. Definir un timeout HTTP compatible con los presupuestos
actuales de las funciones, en vez de uno corto de ejemplo. Las respuestas de
`pg_net` tienen retención limitada; guardar un resumen operativo sin secretos ni
cuerpos. [Referencia de pg_net](https://supabase.com/docs/guides/database/extensions/pg_net).

### 5. Caídas, 429 y cuotas — media/alta

Hay clasificación de fallos temporales, Retry-After y presupuesto de fallos del
worker. Los fallos permanentes requieren intervención; no todos deben reintentarse.
Añadir avisos y pausa de nuevas ejecuciones ante fallos generales repetidos. No
insistir cada minuto contra una espera impuesta por el proveedor. Microsoft puede
aplicar throttling también por tráfico compartido del tenant, aunque este módulo
reciba pocos correos. [Guía de throttling](https://learn.microsoft.com/en-us/graph/throttling).

### 6. Solapamientos y respuestas perdidas — media/alta

Ya existen reservas con tokens, versiones, bloqueo por fila y unicidad del mensaje.
La creación/vínculo de la request es transaccional. Los replays reales conservaron
ambas requests. Esos controles son por conexión/importación, no un límite global
de todos los workers. Propuesta inicial: un análisis simultáneo y despliegue de
tareas con nombres estables para evitar cron duplicados. Una respuesta perdida
después de guardar se resuelve releyendo el mismo importId, no creando otro.

Una inferencia puede repetirse si Mistral respondió pero el checkpoint no se pudo
guardar. Se puede reducir con avances y presupuestos; no se promete cero llamadas
repetidas al proveedor en cualquier caída de red.

### 7. Continuaciones sin progreso — alta, caso potencial

Las continuaciones conservan avances y no consumen el presupuesto de fallos,
lo cual permite terminar correos grandes. No se encontró un límite operativo de
continuaciones sin progreso. El worker exige tiempo suficiente antes de cada
fuente y vuelve a comprobarlo después de descargar una imagen. Si una descarga
lenta consume ese margen repetidamente, podría ceder antes de analizar siempre
la misma imagen. No ocurrió en los dos pilotos.

Añadir detección de ausencia de nuevas fuentes ANALYZED, aviso y pausa/revisión
del caso. No medir progreso sólo con updated_at, porque un reintento también lo
cambia. Respetar las esperas programadas para no confundirlas con un bloqueo.

### 8. Adjuntos, memoria y tiempo — media/alta

Existen límites de 10 adjuntos, 10 MB por archivo y 50 MB por correo; validación de
tipo, firma, tamaño y hash. Firmas inline cuentan. HEIC, ZIP, adjuntos de referencia,
archivos corruptos, PDF cifrados/XFA y HTML con binarios incrustados pueden requerir
recuperación manual. No todos los documentos pequeños en bytes son pequeños en
páginas, complejidad o consumo de memoria.

No se encontró una cota explícita de páginas PDF o dimensiones de imagen en estos
adaptadores. Probar extremos admitidos y decidir cotas operativas adicionales sin
recortar silenciosamente fuentes. La plataforma aplica límites de memoria,
duración y CPU por ejecución; el volumen diario no los elimina.
[Límites oficiales](https://supabase.com/docs/guides/functions/limits).

### 9. Original movido, modificado o borrado — alta

Los hashes y la pertenencia a la carpeta protegen contra analizar otra versión
por accidente. Los análisis válidos de imágenes ya terminadas se reutilizan.
Pero una imagen pendiente sólo existe en Graph: mover el correo fuera, cambiar
el adjunto o borrarlo puede impedir continuar. Conservar el original mientras
esté pendiente y acordar cualquier política posterior de archivo. Una copia de
la BD no restaura las fotos que ya no existen en Microsoft 365.

### 10. Duplicados del mismo trabajo con otro mensaje — media

La unicidad protege el mismo ID de mensaje, no dos correos distintos del mismo
trabajo. Copias, reenvíos o seguimientos pueden producir dos requests legítimas
técnicamente aunque parezcan duplicadas para el negocio. Proponer advertencias
por evidencia disponible —orden, propiedad— y revisión humana. Los criterios
de agrupación o rechazo automático serían una decisión funcional aparte.

### 11. Interpretación incorrecta y contenido no confiable — alta

Hay esquema estricto, procedencia, conflictos y reglas deterministas, y la IA
no puede aprobar. El visor representa el correo como texto inerte. Esas medidas
no prueban que cada dato sea verdadero: cadenas reenviadas, datos contradictorios,
OCR pobre o instrucciones maliciosas dentro del correo pueden alterar la propuesta.
Revisar propietario, teléfono, dirección, fecha, Job y alcance antes de aprobar.
Más de tres propietarios y casos ambiguos deben seguir visibles, no descartarse.
Repetir casos de regresión ante cambios del modelo o despliegues; se utiliza
`mistral-small-latest` en el código actual.

### 12. Ediciones humanas y aprobación — media/alta

Ya se conserva la versión exacta abierta para edición/aprobación y se impide que
un replay sustituya una request vinculada. La automatización y su recuperación
deben seguir usando esos contratos. No rellenar retroactivamente requests
aprobadas ni sobrescribir correcciones con una extracción nueva. Crear una
request tampoco garantiza que una coordinadora la atienda: hacer visibles sus
pendientes y mantener la revisión humana.

### 13. Frontend desactualizado o lista pesada — media/alta

El provider carga requests al iniciar y mediante reloadRequests; no se encontró
suscripción de servidor ni sondeo periódico de la bandeja. Una request puede
existir en BD y no aparecer todavía en una pantalla abierta.

Además, el listado actual llama a `read_customer_service_request_intakes` sin un
ID y recibe también el cuerpo original y la extracción de cada correo, sin
paginación explícita del RPC. No conviene sondear toda esa representación cada
minuto al crecer el historial. Proponer lista/resumen ligero paginado, detalles
bajo demanda y actualización al recuperar foco. Conservar intactos formularios
abiertos y probar los conflictos de versión.

### 14. Consumo de IA y repeticiones innecesarias — media

Ya se reutilizan checkpoints válidos y se limita el número de fallos temporales.
Faltan presupuesto operativo por correo/día, seguimiento de gasto y detección de
anomalías. Combinar alertas, límites de uso del proveedor y pausa que conserve la
cola. Si una cota impide analizar el conjunto completo, dejarlo pendiente visible;
no crear una request basada en una fuente truncada. Los límites del proveedor
pueden ser compartidos con otras funciones del proyecto.
[Controles de consumo de Mistral](https://docs.mistral.ai/admin/billing-usage/usage-limits).

### 15. Privacidad y credenciales — alta

No guardar imágenes en Supabase no significa que no se transmitan: Mistral las
recibe para analizarlas. No se verificó la configuración de retención de esa
organización. ZDR es una configuración separada y la Files API no está cubierta.
[Alcance de ZDR](https://docs.mistral.ai/admin/monitor-comply/zero-data-retention).

Usar secretos específicos del servidor, accesos mínimos, rotación y logs sin
contenido personal ni binarios. Vault ayuda a almacenar credenciales, pero hay
que revisar permisos de las colas HTTP: pg_net coloca los encabezados descifrados
en su cola mientras espera el envío. No introducir service_role en el frontend.
[Advertencia del programador](https://supabase.com/docs/guides/functions/schedule-functions).
El archivo local pass.txt está ignorado por Git; eso no lo cifra ni protege sus
copias. Resolver su manejo operativo al terminar las pruebas, sin borrarlo o
rotar claves automáticamente por este informe.

### 16. PDF temporal en Mistral: brecha concreta — alta para PDF

`mistralOcr.ts` intenta DELETE en finally, pero no comprueba response.ok/status.
Una respuesta HTTP de error puede pasar sin confirmar el borrado; una caída dura
también puede impedir ejecutar finally. Se recomienda confirmar la respuesta,
sanitizar los errores y disponer de seguimiento/limpieza de temporales pendientes.
Es distinto del PDF privado que debe conservarse en Supabase. Los dos pilotos
actuales no tenían PDF y no prueban esta limpieza.

### 17. Crecimiento, conservación y restauración — media

Medir cuerpo HTML, extracción, checkpoints, OCR, auditoría, logs, PDF y cuota de
Outlook. Definir retención de registros técnicos y una política de conservación
de negocio por separado. No purgar automáticamente el registro de importación:
también es la memoria contra duplicados. Una restauración puede desalinear BD,
cursor y archivos; requiere comprobación y recuperación controlada, no un borrado
general. La cola HTTP temporal tampoco sustituye la cola durable de importaciones.

### 18. Despliegues y dependencias — media/alta

Un despliegue fallido puede dejar activa la versión anterior; migración, funciones
y frontend deben conservar contratos compatibles. Mantener cambios aditivos,
historial aplicado, pruebas remotas y activación final separada. No depender del
PowerShell del desarrollador o su archivo DPAPI para la ejecución del servidor.
Una pausa previene nuevos trabajos; no deshace llamadas ya enviadas.

## Configuración inicial propuesta, pendiente de aprobación

| Control | Propuesta |
| --- | --- |
| Consulta Graph | Cada minuto, conservando cursor y línea base. |
| Worker | Sólo con trabajo elegible; empezar con un análisis simultáneo. |
| Reintentos | Reutilizar los tres fallos y esperas existentes; respetar Retry-After. |
| Detección de faltantes | Comparar IDs/metadatos cada 15 minutos; inicialmente avisar y revisar diferencias. |
| Salud | Aviso por acceso/carpeta/cuota inválidos o varios minutos sin una sincronización correcta. |
| Cola sin progreso | Aviso orientativo a los 15 minutos, excluyendo esperas programadas; umbral por validar. |
| Volumen anómalo | Aviso orientativo sobre 20 correos/día; no rechazar automáticamente el correo 11. |
| Gasto | Presupuesto acordado y seguimiento por proveedor/fuente; conservar la cola al pausar. |
| Pantalla | Actualizar resumen/contador y al recuperar foco; evitar descargar todos los originales. |
| Pausa | Control operativo que conserve fuentes, avances e identidad. |

No hace falta una infraestructura grande para este volumen. Sí hace falta que
las discrepancias y los errores sean visibles y recuperables. La caída de un
proveedor, la pérdida del original o una interpretación incorrecta no pueden
eliminarse por completo mediante un programador.

## Verificaciones antes de activar

- Correo realmente nuevo y correo antiguo movido a la carpeta; confirmar ambos
  por el conector normal, sin la recuperación selectiva del piloto.
- Correo estrictamente sin adjuntos, imagen con texto y combinación PDF+imagen.
- Fallos simulados 401/403/429/5xx, respuesta perdida después de guardar y reserva
  vencida; confirmar continuidad, diagnóstico e idempotencia.
- Continuaciones con y sin progreso, adjuntos grandes y PDF complejo/cifrado.
- Varios mensajes juntos y reintento manual concurrente con el programador.
- Pantalla abierta durante una importación y formulario con cambios sin guardar.
- Confirmación de borrado de temporales PDF del proveedor y conservación de su PDF
  privado en Supabase; ausencia de archivos/binarios nuevos de imagen.

Las recomendaciones no se han aplicado. La consulta confirmó que Vault existe,
pero no están instalados pg_cron ni pg_net y no existe cron.job. Las dos requests
de prueba siguen siendo evidencia de procesamiento, no de automatización activa.

## Referencias del proyecto

- [Reglas y decisiones vigentes](C:/Users/u/Documentos/Proyectos/ValtrimBilling/docs/customer-service-business-rules.md).
- [Evidencia de las reimportaciones reales](C:/Users/u/Documentos/Proyectos/ValtrimBilling/docs/customer-service-email-retest-2026-10-30.md).
- [Consulta Graph y paginación](C:/Users/u/Documentos/Proyectos/ValtrimBilling/apps/backend/supabase/functions/_shared/customerServiceMicrosoftGraph.ts:523).
- [Presupuestos y continuaciones del worker](C:/Users/u/Documentos/Proyectos/ValtrimBilling/apps/backend/supabase/functions/_shared/customerServiceEmailWorker.ts:31).
- [Eliminación del temporal OCR](C:/Users/u/Documentos/Proyectos/ValtrimBilling/apps/backend/supabase/functions/_shared/mistralOcr.ts:374).
- [Carga actual de la bandeja](C:/Users/u/Documentos/Proyectos/ValtrimBilling/apps/frontend/src/features/customer-service/context/CustomerServicePrototypeProvider.jsx:17).
- [Repositorio del listado](C:/Users/u/Documentos/Proyectos/ValtrimBilling/apps/frontend/src/features/customer-service/services/customerServiceIntakeRepository.js:6).
- [Contrato de lectura existente](C:/Users/u/Documentos/Proyectos/ValtrimBilling/apps/backend/supabase/migrations/20261029190000_customer_service_three_customers.sql:1568).
