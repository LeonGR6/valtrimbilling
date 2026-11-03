# Reimportación manual de correos — 30 de octubre de 2026

## Alcance y estado

Prueba real autorizada después de eliminar CS-1876 y CS-1974 y sus importaciones.
Se ejecutan las funciones existentes contra el proyecto remoto enlazado. No se
reinicia el cursor, cambia la configuración, activa cron ni aprueban requests.
Los movimientos de los mensajes en Outlook los realiza el usuario.

Al inicio había tres requests ajenas a la prueba: CS-1055, CS-1064 y CS-1288;
cero importaciones, cero registros de imagen y dos registros de PDF en
`stored_files`. Storage contenía un objeto en `customer-service-imports` y dos
en `customer-service-sources`. Estos conteos incluyen objetos históricos ajenos
a esta ejecución; no significan que todos tengan una referencia publicada.

## Primer correo: tres propietarios — procesado y verificado

- Importación nueva: `731ab97d-e046-45bb-98c2-e7c3e9fc2f57`.
- Request nueva: **1022 / CS-2022**, `NEEDS_REVIEW`, sin aprobación.
- Fuente V2 / AVAILABLE: cuerpo y cuatro imágenes inline GRAPH_ONLY.
- Worker: HTTP 200 / PROCESSED en la primera invocación; un intento, cero fallos.
- Cinco fuentes ANALYZED: cuerpo y cuatro imágenes. Las imágenes no devolvieron
  texto pertinente y conservan `fileId = null`.
- Tres contactos: un PRIMARY y dos ADDITIONAL, en posiciones 1, 2 y 3.
- Los tres tienen nombre y teléfono con formato `+1` y diez dígitos nacionales.
  Una comparación SQL, sin exportar nombres ni números, confirmó que cada
  teléfono aparece en el cuerpo y corresponde al mismo propietario extraído.
  Nombres y teléfonos guardados coinciden con el intake del análisis.
- Clasificación guardada: ADJUSTMENT / DOORS / GENERAL_FIX.
- Un ítem de trabajo, **30 minutos y crew 1**.
- La segunda ejecución del worker devolvió la misma request, con
  `idempotentReplay = true`; el contador de intentos siguió en uno.
- Cero vínculos de archivos para esta importación, cero registros nuevos de
  imagen y conteos de objetos de Storage sin cambios.
- La comprobación recursiva del cuerpo/manifiesto/referencias/análisis/intake/
  checkpoints no detectó binarios/base64.
- Las huellas de las tres requests ajenas permanecieron iguales.

## Segundo correo — procesado mediante recuperación selectiva manual

- Importación nueva: `1e108d34-f9c4-46e0-99c5-3e59fd86e56e`.
- Request nueva: **1023 / CS-2023**, `NEEDS_REVIEW`, sin aprobación.
- Fuente V2 / AVAILABLE: cuerpo y siete imágenes GRAPH_ONLY, sin PDF.
- Worker: HTTP 200 / PROCESSED en la primera invocación; un intento, cero fallos.
- Ocho fuentes ANALYZED: cuerpo y siete imágenes, sin texto pertinente extraído
  de las imágenes en esta ejecución.
- Un contacto PRIMARY, con nombre y teléfono +1 coincidentes con el intake.
- Clasificación guardada: ADJUSTMENT / DOORS / GENERAL_FIX; un ítem de trabajo,
  **30 minutos y crew 1**.
- La repetición del worker devolvió la misma request, con
  `idempotentReplay = true` y el contador de intentos en uno.
- Cero vínculos de archivos, cero registros de imagen, objetos de Storage sin
  cambios y comprobación recursiva de binarios/base64 negativa.

### Diferencia observada en la detección

Tras las confirmaciones de movimiento del usuario, las consultas incrementales
devolvieron HTTP 200 / ROUND_COMPLETE, sin mensajes, importaciones ni errores.
Las rondas realizadas mientras los mensajes estaban fuera tampoco devolvieron
eventos `removed`; no se presenta su salida como confirmada por Graph.

Se localizaron en el archivo autorizado las credenciales Microsoft ya configuradas
y se verificaron contra sus digests, sin mostrar ni guardar sus valores. Una
lectura directa GET confirmó la carpeta raíz Customer Service del buzón esperado:
tres mensajes, incluido el primero ya importado, uno no importado con siete
imágenes recibido el 27 de octubre y otro mensaje anterior ajeno a esta prueba.
La lectura de los adjuntos en esta fase fue únicamente de metadatos.

El helper puntual `.temp/reimport-selected-graph-email-20261030.ts` identificó
exclusivamente ese mensaje por su ID leído de Graph, buzón, carpeta y fecha.
Reutilizó los adaptadores actuales de conexión, Graph, registro, validación completa
y finalización de fuentes V2. Tomó y liberó la reserva existente, validó las siete
imágenes en memoria y conservó exactamente cursor, inicialización y política de
sincronización. Se ejecutó sin permiso de escritura al sistema de archivos. No
se modificó Outlook ni se creó un endpoint nuevo. Después se usó el worker
desplegado para analizar y crear la request; no se alteró su guardado normal.

La operación quedó auditada como `SERVICE_EMAIL_MANUAL_REIMPORT`, con motivo
`DELTA_EMPTY_MESSAGE_PRESENT`. Se comprobó que existen exactamente dos
importaciones y se dejó el tercer mensaje sin importar.

Esto confirma la lectura y el procesamiento del segundo correo, **no su detección
por la consulta incremental**. La causa de la diferencia todavía no está
determinada: no se atribuye sin evidencia a un filtro, una demora o un movimiento
específico. Es un punto pendiente de diagnóstico antes de certificar o activar
la consulta periódica.

## Comprobación final

Las dos requests permanecen NEEDS_REVIEW y sin revisión/aprobación registrada.
Hay dos importaciones PROCESSED, trece fuentes analizadas (dos cuerpos y once
imágenes), cero fuentes fallidas y cero registros nuevos de imagen o binarios.
Storage conserva los conteos iniciales. Las huellas de CS-1055, CS-1064 y CS-1288
siguen iguales. La conexión conserva BASELINE_ONLY, cursor DELTA, línea base vacía,
sin reserva activa ni último error. No se activó ejecución periódica.

## Límites de la comprobación

Esta prueba confirma el guardado real de ambos correos y sus replays del worker.
Una ronda delta vacía no demuestra por sí sola la entrega duplicada del mensaje.
No se ha confirmado la revisión visual con el frontend publicado ni la aprobación
humana. Ninguno incluye PDF y sus imágenes no devolvieron texto útil en esta
ejecución; no certifica por sí sola OCR de PDF ni fotografías con texto pertinente.

El plugin de Outlook conectado pertenece a otra cuenta. El acceso de control al
navegador caducó, por lo que no se modificó Outlook mediante automatización UI.
Los secretos se utilizaron en memoria y no se incluyeron en este informe.
