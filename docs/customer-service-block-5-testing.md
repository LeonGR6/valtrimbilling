# Customer Service — bloque 5: recuperación de PDF

Implementado el 20 de octubre de 2026. **Pendiente de despliegue** de la Edge
Function `customer-service-source-pdf`. No hay migración nueva, cambios en RLS,
formulario, autorización, límite de un PDF de 10 MB o reglas de aprobación.

## Corrección

Se eliminó el borrado del objeto durante la recuperación y el manejo de errores.
La ruta privada continúa siendo `requests/{id}/source.pdf`, con `upsert: false`.
Cuando la subida reporta error, la función intenta leer ese objeto y compara
tamaño y SHA-256 con el archivo recibido antes de finalizar. Un objeto distinto
produce conflicto y se conserva; no se sustituye ni se marca como fallo de una
subida ajena.

Si falla la respuesta de finalización después del commit, se conserva el PDF y
el estado AVAILABLE del servidor. El siguiente intento utiliza el mismo archivo
y el RPC idempotente existente. Una falla de red por sí sola ya no se presenta
como conflicto con un PDF diferente cuando el estado inicial era AVAILABLE.
Si la finalización no llegó a ejecutarse, el objeto retenido también permite
completar el intento siguiente, tanto desde PENDING como desde FAILED.

La operación común `retainCustomerServiceSourcePdf` se encuentra junto a los
auxiliares de PDF existentes y recibe sus transportes como parámetros. Las pruebas
ejecutan esa misma operación con almacenamiento simulado sin acceso de red.
La función HTTP conserva las validaciones y los RPCs anteriores.

## Verificación

La suite de PDF incluye 12 casos: 4 auxiliares y 8 de coordinación. Cubre subida
normal, respuesta de subida perdida, interrupción antes de finalizar, respuesta
de finalización perdida después del commit, falla antes del commit, concurrencia
con archivos iguales, concurrencia con archivos distintos del mismo tamaño y
lectura fallida que impide verificar una escritura incierta.
Resultado: **12 aprobadas, 0 fallidas**. La regresión de `_shared` y
`users-admin/user-status.test.ts` también pasó: **52 aprobadas, 0 fallidas**.
La comprobación de tipos de la Edge Function modificada pasó.

```powershell
cd C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend
npm run functions:test-source-pdf
npx --no-install deno check --config supabase/functions/deno.json --lock supabase/functions/deno.lock supabase/functions/customer-service-source-pdf/index.ts
```

El diagnóstico de la revisión previa también ejecuta el cuerpo actual de
`uploadSourcePdf` con dobles en memoria y comprueba que una respuesta de
finalización perdida deja el objeto intacto y permite repetir con éxito:

```powershell
cd C:\Users\u\Documentos\Proyectos\ValtrimBilling
node tmp/customer-service-email-import-audit/source-pdf-retry-probe.mjs
```

Son verificaciones aisladas de coordinación y tipos; no equivalen a una prueba
HTTP con Storage real. No se aplicó SQL ni se ejecutó una carga contra Storage
remoto para este cambio. Las suites pgTAP de la revisión anterior conservan su
resultado; no se han repetido por este cambio exclusivo de Edge Function.

## Activación pendiente

Desplegar exclusivamente `customer-service-source-pdf` mediante el mecanismo
habitual del proyecto. No se necesita `db push`. Después, validar con una request
de prueba: creación con PDF, apertura privada, reintento del mismo archivo y
rechazo de otro archivo. El acceso del conector de Microsoft 365 se configura en
una etapa aparte; este bloque no lo habilita.
