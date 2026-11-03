# Imágenes sin retención — bloque 4: visor

Implementado localmente el **28 de octubre de 2026**. Este bloque modifica solo
el frontend y sus pruebas/documentación. Reutiliza el RPC autenticado
`read_customer_service_import_sources`, ya instalado. **No requiere migración ni
redesplegar Edge Functions.** La publicación del frontend y el piloto integral
con un correo real no se realizaron en esta entrega.

## Comportamiento

- El visor compartido Source & extraction de View/Edit Request consulta el
  manifiesto completo, incluidos adjuntos inline y las imágenes GRAPH_ONLY sin
  fileId. Ya no depende exclusivamente de la lista de archivos almacenados.
- Selecciona por attachmentId: varias imágenes con fileId null se pueden revisar
  individualmente. No abre automáticamente archivos al cargar la lista.
- Para cada adjunto muestra estado, texto pertinente, datos de documento/
  propiedad/contactos/trabajos y advertencias de la extracción original. Distingue
  análisis terminado sin texto, análisis fallido y ausencia de análisis retenido.
- Las imágenes nuevas muestran que su archivo no está almacenado. No tienen
  vista previa, descarga, URL privada ni lectura desde Graph en el navegador.
  El enlace Open in Outlook usa el correo original y se valida como HTTPS sin
  credenciales embebidas, conservando la política de enlaces existente.
- PDF y archivos históricos con referencias conservan sus controles privados de
  apertura/descarga/renovación. La lista no certifica existencia física: una
  referencia antigua puede apuntar a un objeto eliminado. Un fallo al abrirlo
  deja la extracción visible y muestra el error sin subir o recuperar el archivo.
- El usuario indicó que eliminó las imágenes históricas de CS-1876 por su cuenta
  en Storage. Esta implementación no elimina ni modifica sus referencias en BD,
  no las convierte a V2 y no las restaura. No se comprobó su existencia real en
  esta entrega; se validó el caso equivalente con una respuesta de archivo borrado.
- Los errores de sesión/permisos/red permanecen visibles con Retry loading;
  las fuentes rechazadas y los correos sin adjuntos no se confunden. Recargar
  vuelve a consultar metadatos; no persiste binarios, URLs o estado de selección.
- Los mensajes ya no afirman que todos los originales están retenidos. Cuando
  no existe texto combinado, la pestaña Analyzed text dirige a Original email
  para revisar el cuerpo y la extracción por adjunto. El PDF de recuperación y
  su OCR/JSON siguen separados de la fuente original del correo.
- El visor es de consulta. No extrae de nuevo, modifica formularios, crea
  requests, aprueba ni activa sincronización periódica.

## Archivos principales

- `OriginalEmailSource.jsx`: lista completa y selección por adjunto, información
  de retención y acceso al correo original.
- `ImportAttachmentAnalysis.jsx`: texto y hechos legibles de cada análisis.
- `customerServiceImportSourceRepository.js`: lectura V1/V2, validación de
  identidad/retención y rechazo de ecos binarios. Los adjuntos GRAPH_ONLY se
  rechazan antes de solicitar un enlace de archivo.
- `SourcePdfPreviewDialog.jsx`: mensajes correctos de retención y orientación
  sobre la extracción por fuente.
- `SourceFilePreview.jsx`: una imagen que falla al mostrarse deja de ofrecer
  controles de descarga/apertura; PDF mantiene sus opciones de visualización.

## Validación realizada

- **453 pruebas frontend aprobadas**, incluidas **17 del visor/repositorio**.
  Cubren V1/V2, varias imágenes sin fileId, mezcla PDF+imagen, estados de análisis,
  identidad ajena/duplicados, binarios/data URI, URLs inseguras, permisos,
  referencias faltantes, recarga y separación del PDF de recuperación.
- ESLint aprobado en los cinco archivos JS/JSX de esta entrega.
- Compilación de producción aprobada. Conserva el aviso de tamaño de algunos
  chunks; no se amplió el alcance a reorganizar el empaquetado.
- Playwright CLI con servidor aislado y componentes reales, datos sintéticos y
  Supabase simulado: imagen con texto, foto sin texto, análisis fallido/ausente,
  PDF+imagen, imagen histórica eliminada, correo sin adjuntos, fuente rechazada,
  fallo de permisos y reintento de lectura. El contenido del iframe PDF fue
  simulado: se comprobaron controles y selección, no un decodificador PDF real.
- Al revisar las imágenes nuevas se observó únicamente la lectura de metadatos,
  cero solicitudes de archivos y cero elementos img. Seleccionar el PDF añadió
  solo la petición de su fileId. El HTML del correo permaneció inerte y no se
  cargó su píxel remoto. No hubo llamadas reales a Graph, Mistral o Storage.
- Vista de escritorio y móvil de 390 × 844: sin desbordamiento horizontal.
  Evidencia sintética en `output/playwright/block4-image-extraction-desktop.png`
  y `output/playwright/block4-image-extraction-mobile.png`.

## Repetir comprobaciones

Desde `apps/frontend`:

```powershell
node --test tests/customer-service-source-viewer.test.mjs
npm test
npx eslint src/features/customer-service/services/customerServiceImportSourceRepository.js src/features/customer-service/components/OriginalEmailSource.jsx src/features/customer-service/components/ImportAttachmentAnalysis.jsx src/features/customer-service/components/SourcePdfPreviewDialog.jsx src/features/customer-service/components/SourceFilePreview.jsx
npm run build
```

Después de publicar el frontend, revisar con sesión ADMIN/SCHEDULING una request
V2 y la request histórica. Confirmar que los datos extraídos sobreviven a la
recarga y a las correcciones humanas, y que un archivo eliminado produce un error
sin restaurarse. El piloto completo Outlook → Graph → análisis → request →
revisión humana sigue siendo una etapa posterior; no activar cron con esta entrega.
