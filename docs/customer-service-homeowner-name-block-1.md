# Extracción del nombre del propietario — bloque 1

Implementado localmente el 2 de noviembre de 2026. Sin migración ni despliegue.

## Problema y alcance

La prueba automática detectó un contacto HOMEOWNER con nombre null y el nombre
explícito en sourceLabel. La validación del mínimo impidió crear la request.
El [registro de la prueba](customer-service-email-automatic-test-2026-11-02.md)
conserva el resultado original.

Este bloque mejora la extracción nueva. La recuperación de la importación
2965cf60-2267-4f38-950c-ffd495d31df3 corresponde al bloque 2.

## Cambios

- Instrucciones del importador y descripciones del esquema aclaran `name`, rol
  y `sourceLabel`. Incluyen ejemplos sintéticos de un nombre antes del teléfono
  y dirección, una etiqueta sin nombre y una firma de constructor. Los ejemplos
  son solo de asignación de campos y no son datos para completar la extracción.
- En texto de correo, nombres HOMEOWNER/PRIMARY_CONTACT se comprueban contra el
  texto de esa fuente. La comparación normaliza acentos, mayúsculas, espacios y
  puntuación; el valor aceptado conserva su escritura original. La coincidencia
  respeta palabras completas: un nombre parecido no valida otro nombre.
- Etiquetas genéricas conocidas y nombres no verificables quedan null, con una
  advertencia comprensible. No se cambian roles, orden ni otros datos. Un nombre
  en sourceLabel se conserva como evidencia, sin convertirse automáticamente
  en un nombre personal.
- Campos PDF declaran PDF_FIELDS al invocar el extractor de texto. Mantienen la
  extracción de nombres desde valores separados de formulario; allí se revisan
  etiquetas genéricas, sin exigir una frase contigua de nombre completo.
- Se comprueban binarios antes de validar nombres y se vuelve a validar el
  objeto completo después. Se conservan los límites del esquema; las
  advertencias originales no se recortan para aceptar una respuesta inválida.
- No se agregan llamadas a Mistral, descargas, almacenamiento ni cambios de
  contrato en BD. Los checkpoints históricos siguen usando el parser existente.

## Límites

Las instrucciones mejoran la asignación solicitada al modelo, pero no garantizan
que toda respuesta futura sea correcta. Los casos ambiguos siguen para revisión.
La validación de correo exige que el nombre completo pueda verificarse en ese
fragmento de texto. No une automáticamente palabras de partes diferentes ni
identifica a una persona a partir de una etiqueta o firma.

No se modificó ni reencoló la importación del piloto y no se ejecutaron Graph,
Mistral ni operaciones sobre la BD real. Un reintento con su checkpoint antiguo
puede conservar el nombre vacío. El bloque 2 debe permitir revisar el texto
incompleto conservando la identidad y las dos imágenes ya analizadas.

## Validación

Pasaron **164 pruebas Deno** y los tipos de worker, retry y
extract-customer-service-pdf. Se usaron proveedores/archivos simulados, sin
permisos de red de ejecución de pruebas ni stack Docker.

Los casos nuevos cubren nombre explícito junto a teléfono/dirección, etiquetas
genéricas con índices/puntuación, nombre ausente, nombre mal ubicado en
sourceLabel, builder separado, nombre no escrito o que solo coincide como
subcadena, acentos/apóstrofes/guiones, varios propietarios, valores PDF
separados, contenido binario y límites de advertencias. Las regresiones cubren
reutilización de fuentes, imágenes en memoria, PDF, reintentos y aprobación.

Desde apps/backend pueden ejecutarse:

```powershell
npm run functions:test-email-analysis
npm run functions:test-email-worker
npm run functions:test-email-retry
npm run functions:check-email-worker
npm run functions:check-email-retry
```

## Despliegue conjunto pendiente

El [bloque 2 ya está preparado localmente](customer-service-homeowner-name-block-2.md).
Seguir sus comandos completos: ahora debe aplicarse su migración nueva antes
de desplegar las funciones de ambos bloques. El detalle siguiente documenta
las dependencias originales del bloque 1.

Según el plan acordado, los cambios se publican al terminar el bloque 2.
Este bloque no exige migración, cambios de secretos ni de configuración.
Las funciones del importador que consumen el extractor son worker y retry.
Los comandos de despliegue, cuando ambos bloques estén listos, son:

```powershell
Set-Location 'C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend'
npx supabase functions deploy customer-service-email-worker --use-api
npx supabase functions deploy customer-service-email-retry --use-api
```

Después del bloque 2 y del despliegue se comprobará la recuperación real del
piloto: misma importación, una sola request NEEDS_REVIEW, imágenes reutilizadas
y aprobación humana pendiente.
