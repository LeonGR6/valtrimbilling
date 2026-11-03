# Piloto real de correo — 29 de octubre de 2026

El usuario autorizó probar el correo que añadió a la carpeta Customer Service y
usar el secreto de sincronización de `docs/pass.txt`. Se comprobó su coincidencia
con la huella configurada en Supabase, sin imprimir ni copiar el valor. No se
rotaron claves, desplegaron funciones, aplicaron migraciones ni activó cron en
esa primera ejecución. La corrección autorizada posteriormente se registra al final.

## Caso recibido

- ImportId: `f118794d-b785-4e18-83d9-44aecbd17e29`.
- Contrato: V2, fuente AVAILABLE.
- La sincronización devolvió HTTP 200 / ROUND_COMPLETE con una sola importación
  nueva, sin errores y con cursor DELTA/reserva liberada.
- El correo parecía contener solo texto, pero Graph detectó **cuatro imágenes
  inline**, todas GRAPH_ONLY: un JPEG y tres PNG, 41.118 bytes reales en total.
  No contenía PDF. El cuerpo HTML fue normalizado y analizado como una fuente
  EMAIL. Por tanto, **este piloto no certifica el caso estrictamente sin adjuntos**.

## Resultado inicial del análisis, antes de la corrección

Se invocó el worker únicamente con ese importId, usando la copia cifrada de su
secreto ya existente. En un intento se analizaron correctamente **cinco fuentes**:
el cuerpo y las cuatro imágenes, todas ANALYZED y sin errores de proveedor.
Las imágenes no aportaron texto pertinente ni trabajos adicionales; se conservó
su análisis sin archivos o bytes/base64.

El resultado fue **NEEDS_ATTENTION / ANALYSIS_INCOMPLETE**, con la única incidencia
bloqueante `MISSING_OR_AMBIGUOUS_HOMEOWNER`. La comparación con el texto original
confirmó **tres contactos bajo Homeowner Contact Info**, sin indicación de cuál
es el principal. No faltaban nombres ni falló la lectura: la regla entonces vigente no
elige arbitrariamente entre propietarios. Se conservó un trabajo solicitado.
Las advertencias generadas por IA son evidencia para revisión, no reglas nuevas.

No se creó una request ni se asignó folio. Debe definirse el contacto principal
durante la revisión/recuperación humana. No se alteró la extracción para forzar
el alta ni se usó el remitente o representante del constructor como propietario.

## Comprobaciones independientes de la primera ejecución

| Comprobación | Resultado |
| --- | --- |
| Importaciones para la misma identidad de mensaje | 1 |
| Requests vinculadas a esta importación | 0 |
| Requests totales, antes/después | 5 / 5 |
| Archivos registrados / vínculos / objetos Storage de esta importación | 0 / 0 / 0 |
| Referencias de archivo del manifiesto | 0 |
| Guard SQL de binarios sobre el registro completo | false: sin transportes binarios detectados |
| Objetos en customer-service-imports, antes/después | 1 / 1 |
| Objetos en customer-service-sources, antes/después | 2 / 2 |
| Intentos del worker / fallos transitorios | 1 / 0 |
| Reserva de worker al terminar | Liberada |
| Siguiente folio disponible, antes/después | CS-1974 / CS-1974 |

Una segunda llamada al worker, **sin reencolar**, devolvió IDLE: la importación
permaneció NEEDS_ATTENTION con un solo intento y la misma versión updated_at.
No se repitió inferencia ni se consumió folio. Una segunda ronda de sincronización
terminó ROUND_COMPLETE con cero importaciones nuevas y sin errores. Estas lecturas
se realizaron contra la BD enlazada, mediante transacciones READ ONLY / ROLLBACK.

## Numeración y alcance pendiente

El alta manual y la importación automática insertan en la misma tabla y usan su
default `CS-` + `valtrim.service_request_folio_seq`; no existen contadores separados
por origen. Una secuencia puede tener saltos: los números consumidos por pruebas
o inserciones revertidas no se recuperan. No se reinició ni adelantó el contador.

Según el plan reducido por el usuario, no se repitieron las etapas de preparación
ni revisión visual/histórica. No hubo aprobación humana ni modificación de datos
de negocio. Al terminar esa ejecución seguían pendientes el correo realmente sin
adjuntos, los otros casos acordados y la revisión/recuperación de esta importación. No presentar ese
resultado como alta exitosa en NEEDS_REVIEW ni como automatización periódica activa.

## Corrección autorizada: primer propietario como principal

Después del diagnóstico, el usuario aprobó usar como principal al primer
propietario del correo. Se modificó la selección compartida por worker/reintento
y se indicó al extractor conservar el orden de aparición. Los tres propietarios
se conservan en la extracción; solo el primero se propone como principal. Los
otros dos quedan disponibles para revisión, sin elegir automáticamente entre
varios candidatos adicionales ni ampliar el formulario. No se relajan límites,
validación de fuentes o aprobación humana.

Validación local final: 74 pruebas de análisis y 44 de worker aprobadas. Incluyen dos
y tres propietarios, orden de aparición, exclusión del representante, nombre
inválido y reanudación de un reporte bloqueado desde checkpoints válidos sin
Graph, Storage o nueva inferencia. Los endpoints worker/retry pasan tipos y los
seis archivos afectados pasan lint. No se necesita migración SQL.

### Resultado de la recuperación autorizada

Se desplegaron worker y retry y se reencoló solo este importId, con versión,
huellas de fuente/checkpoint, incidencia exacta y bloqueo de fila. La auditoría
SYSTEM identifica la corrección FIRST_HOMEOWNER_AS_PRIMARY. Se conservaron
identidad, originales y presupuestos de intentos/fallos; no se amplió el reintento
general del script a todos los casos ANALYSIS_INCOMPLETE.

El worker devolvió HTTP 200 / PROCESSED, request **974 / CS-1974**, en
**NEEDS_REVIEW**, con un ítem y el primer propietario como contacto principal.
La BD confirmó que coincide con el primero del cuerpo del correo. Los tres
propietarios permanecen en la extracción y los otros dos requieren selección
humana si se desea completar el único contacto adicional permitido. Repetir el
worker devolvió la misma request con idempotentReplay=true.

La verificación detectó una incidencia adicional: el orden de claves de `part`
cambia al volver desde PostgreSQL jsonb; la comparación con JSON.stringify hizo
repetir el análisis del cuerpo en esta recuperación. Las imágenes reutilizaron
sus resultados. Se corrigió la comparación a valores start/end, conservando el
rechazo de offsets/texto alterados o claves adicionales. La regresión reprodujo
el fallo antes de corregirlo. Después se verificaron en memoria los **cinco
checkpoints reales** con el código corregido: cero llamadas al proveedor, cero
descargas y cero escrituras de checkpoints, sin permisos de red/escritura para
ese análisis. No se reabrió ni reanalizó la request ya creada en producción.

Resultado final comprobado en la BD enlazada mediante lectura:

| Comprobación | Resultado |
| --- | --- |
| Importaciones de la misma identidad / requests vinculadas | 1 / 1 |
| Request / folio / estado | 974 / CS-1974 / NEEDS_REVIEW |
| Propietarios conservados en la extracción | 3 |
| Contactos activos / ítems | 1 / 1 |
| Requests totales antes/después de la recuperación | 5 / 6 |
| Fuentes ANALYZED | 5 |
| Intentos antes/después de la recuperación / fallos transitorios | 2 / 3 / 0 |
| Archivos registrados / vínculos / objetos Storage de esta importación | 0 / 0 / 0 |
| Referencias de archivo / binarios detectados | 0 / false |
| Objetos en ambos buckets | Sin cambios: imports 1, sources 2 |
| Huellas del cuerpo original, manifiesto y referencias | Sin cambios |
| Auditorías de esta corrección | 1 |
| reviewed_by / reviewed_at / valtrim_items_confirmed | null / null / false |
| Reserva del worker | Liberada |

Versiones al cerrar esa recuperación: **worker v12**, **retry v8**, **sync v9**. No hubo
migración, cambio de claves ni activación periódica. La revisión visual y
aprobación de CS-1974 siguen pendientes, junto con el caso estrictamente sin
adjuntos y los demás escenarios reales del plan reducido.

## Ampliación posterior a tres customers y teléfonos

El usuario aclaró que el formulario debe incorporar los tres propietarios y
aprobó añadir +1 a teléfonos sin prefijo cuando la dirección identifique Estados
Unidos. Se amplió formulario/BD/importador a un principal y dos adicionales.
La migración nueva `20261029190000` está aplicada y se actualizaron worker/retry.

Se completaron los tres contactos y teléfonos de **974 / CS-1974**, con auditoría
SYSTEM, versión y huellas exactas, conservando cualquier canal ya capturado.
La lectura confirmó los tres nombres y sus propios números normalizados desde
la extracción. No se invocó IA/Graph ni se reescribió análisis/checkpoints. No se
creó otra request ni se guardaron imágenes o binarios. Los originales y demás
campos de la request permanecen idénticos por huella. Sigue NEEDS_REVIEW, sin
revisión/aprobación humana. El formulario está actualizado localmente; el sitio
no se publicó. Ver [pruebas y comandos](customer-service-three-customers-2026-10-29.md).

## Diagnóstico y reglas de planificación posteriores

El usuario mostró que CS-1974 tenía General fix pero Work type, duración y crew
vacíos, y autorizó compartir las reglas del formulario con el importador. Se
comprobó el JSON real en solo lectura: Adjustment y GENERAL_FIX estaban presentes;
suggestedWorkType era null y el payload anterior no enviaba duración/crew.

El código nuevo propone en memoria Doors, 30 minutos y una persona, sin cambiar
las fuentes o la request. El frontend actualizado ofrece esas sugerencias al
abrir Edit y requiere Save changes; View conserva lo guardado. No se reencoló ni
reescribió CS-1974 y sigue pendiente de revisión humana. Los despliegues de
worker/retry y la publicación frontend los ejecutará el usuario; no hace falta
migración. Ver [validación y comandos](customer-service-planning-rules-2026-10-29.md).
