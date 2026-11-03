# Importación por correo — bloque 4: análisis compuesto

Implementación local del 22 de octubre de 2026. No se aplicó la migración nueva,
no se desplegaron funciones ni se enviaron correos/documentos reales a Mistral.
Este bloque pertenece al plan de correo, no al antiguo bloque 4 de limpieza.

Verificación posterior: el usuario aplicó la migración. Se comprobó el historial
remoto y pasaron las nueve suites indicadas abajo con ROLLBACK. Los comandos de
aplicación se conservan como referencia; no volver a instalar SQL ya aplicado.
El worker se prepara después en el [bloque 5 de correo](customer-service-email-import-block-5-testing.md).

## Entrega y alcance

Entrada del servidor: `extractCustomerServiceEmailImport(admin, importId,
{ apiKey })`, en `supabase/functions/_shared/customerServiceEmailExtraction.ts`.
Requiere la fuente AVAILABLE del bloque 3 y un cliente de servicio; no se invoca
desde el navegador ni acepta rutas de Storage elegidas por el usuario.

- Cuerpo completo: texto y HTML normalizado inerte, incluidos los reenvíos;
  sin ejecutar scripts ni descargar recursos externos. Las partes largas se
  dividen con offsets, sin recortar silenciosamente el contenido.
- PDF: OCR con cobertura de páginas, más valores AcroForm leídos por separado,
  incluidos checkboxes sin apariencia visual. No se modifica el original.
  PDF protegido/dañado o formulario XFA incompatible produce un problema.
- JPG/JPEG/PNG: visión sobre los bytes privados registrados, no únicamente OCR.
  Antes de inferir se comprueban tamaño, firma y SHA-256 contra el manifiesto.
- Resultado por fuente: identidad original, modelo, hechos estructurados, texto,
  páginas/campos, advertencias y errores. No se guardan binarios/base64 en el JSON.
- Combinación: conserva evidencia y alternativas contradictorias; propone los
  campos compatibles con el intake parcial del bloque 2. No deduce el dueño del
  remitente, país del teléfono, ubicación mediante geocodificación ni aprobación.
  Solo identifica Job automáticamente con coincidencia activa única y coordenadas
  verificadas del catálogo. Trabajo explícitamente de otro proveedor se conserva
  como evidencia, fuera de los ítems propuestos.
- Inferencia exitosa previa puede reutilizarse sin repetir llamadas al proveedor;
  se refrescan catálogo, fechas y propuesta. Una request ya vinculada prevalece
  frente a un análisis tardío y no se sobrescriben las correcciones humanas.

La elección de visión para fotografías sigue la documentación de
[visión de Mistral](https://docs.mistral.ai/studio/conversations/vision); PDF usa
[OCR](https://docs.mistral.ai/studio/document-processing/basic_ocr) y un contrato
estructurado validado. Los valores de formularios se leen con
[pdf-lib](https://pdf-lib.js.org/docs/api/classes/pdfform), separados del OCR.
La IA puede equivocarse: este resultado no sustituye la revisión humana.

## Resultado y persistencia

`READY_FOR_INTAKE` significa que existe una propuesta mínima de propietario más
un ítem descrito y no falló ninguna fuente. Los demás datos pueden quedar nulos,
con advertencias. No es un estado de request ni equivale a READY_TO_PROPOSE.

Si falla una fuente o no se obtiene ese mínimo, el resultado es NEEDS_ATTENTION,
sin payload de guardado. Se conserva el problema técnico y la evidencia disponible.
Los originales válidos ya retenidos en el bloque 3 no se eliminan. Un rechazo de
formato/límites anterior a la subida sigue conservando únicamente el registro
técnico mínimo: es un caso diferente.

La migración `20261022180000_customer_service_import_analysis.sql` añade
`analysis_payload` y fecha del servidor al registro de importación. Su RPC
`record_customer_service_import_analysis` es exclusivo del backend, valida la
identidad y procedencia del conjunto, reutiliza el normalizador del bloque 2 y
no crea requests. El análisis queda separado de `extraction_payload` y protegido
contra reemplazo tras vincular una request; el guardado/edición no borra evidencia.

La creación automática mediante el guardado del bloque 2 corresponde al worker
del bloque 5. Esa request quedará NEEDS_REVIEW. No se modifica el RPC humano de
aprobación. Outlook/Graph y el panel Correos con problemas tampoco se activan aquí.

## Validación local realizada

Desde `apps/backend`:

```powershell
npm run functions:test-email-analysis
npm run functions:test-email-import
npm run functions:check
```

Resultados: **65 pruebas nuevas aprobadas**, **53 regresiones de archivos de
correo** y **26 regresiones de PDF/extracción manual** aprobadas. Las nuevas
pruebas cubren correo solo, PDF, imágenes, fuentes mixtas, campos rellenables,
HTML inerte, contenido largo, conflictos, mínimos, fallos, archivos alterados,
reutilización de análisis y carreras con una request ya vinculada.

También pasaron **396 pruebas frontend**, lint del código nuevo y del frontend,
verificación de tipos de funciones y build. El build conserva el aviso de tamaño
de chunks; no es un error de compilación. Se usan documentos sintéticos y
transportes simulados: no acredita exactitud de inferencia real ni un piloto.

La migración y `customer_service_import_analysis.test.sql` tienen comprobación
sintáctica estática de SQL/PLpgSQL al entregar el bloque. Posteriormente pasaron
esa suite y ocho regresiones en el remoto tras la aplicación por el usuario.

## Pendiente del usuario: migración y pruebas remotas

Desde `apps/backend`, revisar el inventario y el dry-run:

```powershell
npx supabase migration list
npm run db:push -- --linked --dry-run --skip-vault
```

Debe aparecer como nueva pendiente `20261022180000`. Si aparecen otras, revisarlas
antes de continuar. No editar migraciones aplicadas ni usar `--include-all` para
sortear discrepancias. Después de aprobar el SQL pendiente:

```powershell
npm run db:push -- --linked --skip-vault
npx supabase migration list
npm run db:test -- customer_service_import_analysis.test.sql customer_service_import_source_storage.test.sql customer_service_imported_request_intake.test.sql customer_service_email_import_registry.test.sql customer_service_request_intake_schema.test.sql customer_service_source_pdf_storage.test.sql customer_service_intake_read.test.sql customer_service_intake_update.test.sql customer_service_request_ready.test.sql
```

Las pruebas van al Supabase remoto vinculado con fixtures y ROLLBACK, sin Docker.
Comprueban permisos, identidad/procedencia, errores sin request, ausencia de filas
de negocio durante análisis, idempotencia, vínculo NEEDS_REVIEW y conservación
de la evidencia tras guardar o editar. No cargan binarios reales.

**No hay una nueva Edge Function que desplegar en este bloque.** Los módulos se
incorporarán al desplegar el worker del bloque siguiente. La función manual de
PDF y la función de lectura de originales no requieren redespliegue por esta
entrega. La clave Mistral se utilizará solo en servidor cuando se conecte el worker;
no debe pasarse al frontend ni compartirse en el chat.
