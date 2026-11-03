# Tres customers y teléfonos de correo — 29 de octubre de 2026

## Regla y causa corregida

El usuario confirmó que deben incorporarse hasta los tres propietarios del
correo y que los teléfonos sin prefijo deben usar +1 cuando la dirección fuente
corresponda a Estados Unidos. El primero sigue siendo principal. El formulario,
los RPC y la restricción de tabla admitían antes un solo adicional; el importador
no seleccionaba ninguno cuando encontraba varios. Los teléfonos sí estaban en
la extracción, pero se omitían por faltar un prefijo explícito.

La request admite ahora un principal y dos adicionales. El botón Add another
customer permite añadir ambos, quitarlos y conservar al restante con su nombre,
teléfono, país y correo. Crear, editar, recargar y revisar usan la lista completa.
La aprobación comprueba cada customer. Se mantiene la aceptación de los valores
planos anteriores de un adicional para los drafts compatibles; el formulario
visible usa una lista y no trunca el tercer contacto al releerlo.

El importador conserva el orden explícito de HOMEOWNER en cuerpo/adjuntos y no
promueve al remitente o representante. Si encuentra más de tres contactos,
mantiene el resto en la extracción con advertencia visible. No cambia las
imágenes en memoria, límites de adjuntos, PDFs ni aprobación humana.

Los teléfonos originales se conservan en la extracción. Un teléfono de diez
dígitos se convierte a +1 si la dirección tiene estado estadounidense reconocido
(abreviatura o nombre completo) y ZIP con formato válido. Se agrega advertencia
de normalización. No se supone país con un número aislado, ni se reemplaza un
prefijo explícito +52, ni se elige entre números diferentes del mismo contacto.

## Base de datos

Migración nueva aplicada: `20261029190000_customer_service_three_customers.sql`.
No se editaron migraciones aplicadas. Añade contact_number 1/2/3, con PRIMARY en
1 y ADDITIONAL en 2/3. El backfill conserva IDs y datos existentes. La clave
única por posición y el check de rol/posición limitan todas las escrituras a
tres customers. Un trigger asigna posición a los callers que la omiten y toma
el bloqueo de la request para serializar inserciones concurrentes.

Se actualizan las seis definiciones vigentes de creación manual, edición
estándar, normalización/escritura de importaciones, lectura y aprobación,
conservando autorización, versión exacta, auditoría, fuentes y aprobación
independiente. Los números de posición se calculan internamente: no se añade
un campo de posición arbitrario al payload externo. Leer/editar mantiene los
IDs y el orden de los tres contactos. Los helpers privados no tienen permisos
de ejecución para authenticated o service_role.

Se ejecutaron migration list y db push --dry-run antes de aplicar; el único
pendiente era esta migración. El dry-run posterior confirmó migrations=[] y
upToDate=true. La sincronización periódica sigue sin activarse.
Versiones finales verificadas: worker ACTIVE v14, retry ACTIVE v10 y sync
ACTIVE v9. No fue necesario modificar ni redesplegar el conector de sincronización.

## Validación

- 456 pruebas frontend aprobadas; lint completo y build aprobados.
- 78 pruebas de análisis y 44 de worker aprobadas; tipos de worker/retry y lint
  de los archivos backend modificados aprobados.
- Ocho suites distintas pasaron en preview de la migración contra la BD remota,
  con BEGIN/ROLLBACK: esquema, creación manual, lectura, edición, aprobación,
  importación, metadatos de correo y la nueva suite de tres customers.
- La nueva suite pasó además contra el esquema aplicado: 23 aserciones,
  incluyendo tres contactos con teléfonos, edición/remoción, IDs, replay,
  cuarto contacto rechazado, versión vencida, aprobación de todos y tercer
  contacto importado incompleto pendiente de revisión. Los fixtures se revierten.
- Playwright usó el componente real con providers y datos sintéticos, bloqueando
  peticiones externas: guardó tres customers con teléfonos separados, eliminó
  el segundo sin perder el tercero y añadió otro nuevamente. En 390 px no hubo
  desbordamiento horizontal. No se envió una edición desde ese harness a producción.

Comandos de validación:

```powershell
cd C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend
npm run db:test -- customer_service_three_customers.test.sql
npm run functions:test-email-analysis
npm run functions:test-email-worker
```

Los comandos de migración y despliegue ya se ejecutaron en el proyecto enlazado:

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run --skip-vault
npx supabase db push --linked --skip-vault
npx supabase functions deploy customer-service-email-worker --use-api
npx supabase functions deploy customer-service-email-retry --use-api
```

El frontend está actualizado y compilado localmente. No se publicó el sitio.
Los despliegues de Supabase no publican el frontend.

## Corrección de CS-1974

La request 974 / CS-1974 y su importación
`f118794d-b785-4e18-83d9-44aecbd17e29` se conservaron. Se calcularon los tres
contactos desde las cinco fuentes ya analizadas, sin llamar a IA/Graph ni
reescribir el análisis o los checkpoints. Se aplicó una corrección SYSTEM con
versión y huellas exactas, respetando canales ya capturados y rechazando una
selección de contactos diferente hecha por una persona. La auditoría identifica
THREE_CUSTOMERS_US_PHONES. Solo se completaron contactos y canales del principal;
no se reencoló el correo ni se creó otra request.

La lectura posterior confirmó tres customers: cada nombre coincide con su
propietario fuente y cada teléfono con su número original normalizado a +1.
Permanecieron sin cambios las huellas del cuerpo, manifiesto, referencias,
análisis, checkpoints y demás campos de la request. Los objetos de ambos buckets
siguen en 1/2; cero archivos/vínculos nuevos y sin binarios en la importación.
Hay una sola request para la identidad del correo. NEEDS_REVIEW, reviewed_at y
reviewed_by null, valtrim_items_confirmed=false. La revisión humana sigue pendiente.

Los tests remotos pueden consumir secuencias aunque reviertan sus fixtures;
no se reinició el contador ni se exige numeración sin saltos.
