# Prueba automática de importación — 2 de noviembre de 2026

## Alcance

El usuario movió un correo de prueba a la carpeta configurada y avisó que estaba
dentro. Se observaron únicamente lecturas de BD; no se invocaron manualmente
sync, worker, retry ni recuperación. No se cambió código, configuración, cursor,
correo original ni requests. El cron permaneció activo.

Importación: `2965cf60-2267-4f38-950c-ffd495d31df3`.

## Resultado observado

- El conector registró el correo automáticamente a las 15:26:02 UTC
  (09:26:02, America/Mexico_City) y publicó la fuente V2 como AVAILABLE.
- El dispatcher inició el worker a las 15:27:00 UTC. Se realizó un intento,
  sin fallos de proveedor registrados ni reintentos manuales.
- Se analizaron tres fuentes: cuerpo del correo y dos JPEG inline. Las tres
  quedaron ANALYZED. Esta prueba no corresponde a un correo sin adjuntos.
- Las imágenes son GRAPH_ONLY: 3.571.282 y 3.171.360 bytes. No se crearon
  registros de archivo, vínculos de archivo ni objetos de imagen en Storage.
  La comprobación de binarios prohibidos en la fuente/análisis/checkpoint fue
  negativa. No se descargaron los archivos durante la observación.
- El resultado fue NEEDS_ATTENTION / ANALYSIS_INCOMPLETE, con el motivo
  MISSING_OR_AMBIGUOUS_HOMEOWNER. No se creó una request.
- El worker respondió HTTP 200 con NEEDS_ATTENTION; el recolector lo registró
  como IMPORT_NEEDS_ATTENTION. No se interpretó como importación exitosa.

## Causa comprobada

El nombre del propietario sí está escrito en el cuerpo original. En la fuente
EMAIL ya analizada aparece un contacto HOMEOWNER con `name = null` y el nombre
en `sourceLabel`. Una comparación confirmó que ese sourceLabel está presente en
el correo. El fallo existe antes de combinar las fuentes; no es un conflicto
entre imágenes y correo. El reporte de conflictos está vacío.

El texto también contiene un contacto del builder, con nombre, y una descripción
de trabajo válida. Las imágenes no aportaron contactos ni texto extraído. La
regla vigente requiere nombre del propietario y un ítem descrito para crear la
request; el contacto del builder no sustituye al propietario.

La extracción informó incorrectamente ausencia del nombre. El parser conserva
los campos separados, y el combinador/validador no inventó un nombre para
completar el intake. No se modificaron datos para forzar un resultado aprobado.

## Identidad e historial

Solo existe una importación nueva desde la activación. El contador de requests
permaneció en cinco, las existentes CS-2022 y CS-2023 siguen NEEDS_REVIEW y no se
aprobó ninguna request. Los registros y objetos de imagen revisados siguen en
cero. El aviso anterior de un correo del 14 de octubre es un caso distinto.

## Pendiente

La [corrección de extracción, bloque 1](customer-service-homeowner-name-block-1.md)
y el [reintento selectivo, bloque 2](customer-service-homeowner-name-block-2.md)
se implementaron localmente. Pasaron las pruebas simuladas y la validación SQL
remota con rollback. No se han desplegado ni aplicado a esta importación:
la migración, los despliegues y la recuperación real siguen pendientes del
usuario. El resultado de este documento conserva la evidencia previa.

La prueba confirma cron → llamada firmada → Graph → cola → worker → análisis
Mistral → error visible, pero no cierra la creación automática de una request.

Se necesita corregir la extracción/asignación del nombre explícito sin convertir
etiquetas genéricas en nombres ni sustituir al propietario por el builder.
Después deberá retomarse esta misma importación, conservando identidad y análisis
válidos de imágenes. Un reintento sin corregir el dato puede reutilizar el mismo
checkpoint incompleto y no resolver la causa. Queda pendiente verificar la
recuperación, la request y su visualización en el frontend.

## Recuperación posterior comprobada el 2 de noviembre

Después del reintento ejecutado por el usuario, la consulta remota confirmó:

- Misma importación `2965cf60-2267-4f38-950c-ffd495d31df3`, PROCESSED,
  error_code null, informe READY_FOR_INTAKE e issues vacío. Su actualización
  quedó a las 17:20:06 UTC.
- Una sola request vinculada: ID 1031, **CS-2031**, NEEDS_REVIEW y reviewed_at
  null. La aprobación humana sigue pendiente.
- Dos fuentes IMAGE ANALYZED y un EMAIL ANALYZED con contactNameVersion 1.
- Cero importaciones NEEDS_ATTENTION en la consulta realizada. Estas
  comprobaciones fueron de solo lectura, sin volver a ejecutar IA o Graph.

Esto sustituye el pendiente de comprobar la recuperación técnica del registro
anterior. La revisión humana de los campos sigue pendiente.

### Aviso de fallo que persistía tras la recuperación

El dispatcher WORKER conservaba el resultado IMPORT_NEEDS_ATTENTION de las
15:28 UTC, anterior al reintento exitoso. El reintento manual no sustituye esa
respuesta programada y una cola vacía no provoca otra invocación del worker.
La interfaz interpretaba ese resultado histórico como un fallo todavía activo.

Se corrigió localmente la presentación: con problemCount exactamente cero,
el resultado histórico WORKER / IMPORT_NEEDS_ATTENTION deja de activar el
aviso y de aparecer en sus códigos. Una única selección compartida alimenta
el mensaje y la lista de códigos. El registro técnico se conserva; los errores
HTTP, de conexión, inventario, programador o un contador desconocido no se
ocultan. Los correos históricos sin registro mantienen su aviso independiente.

Pasaron 49 pruebas relacionadas de frontend, lint de los archivos modificados
y build. No requiere migración ni despliegue de Edge Functions. La versión
publicada de la app necesita el frontend actualizado para mostrar el cambio.
