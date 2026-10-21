# Plan técnico: Purchase Orders (options) — análisis, verificación e importación

Estado: **propuesta, sin código escrito.** Los PDFs de ejemplo ya están en
`fixtures/private/purchase-orders/` (carpeta ignorada por git: son datos reales de contrato).

## 1. Objetivo

1. Al subir un PDF en **Documents → Purchase Orders**, leer las options que trae.
2. Compararlas contra las options del sistema y **avisar** (nunca bloquear) de cualquier diferencia.
3. Permitir **crear** las options que falten.
4. Sugerir (nunca aplicar solo) el precio del PO cuando difiera del sistema.
5. Al crear un **Package**, mostrar si cada option cargada está respaldada por un PO.

## 2. Lo que traen los PDFs (formato Olson "Vendor Notice")

- Cada página del PDF es un documento independiente (todas dicen "Page 1 of 1"). Un Work Order puede ocupar
  más de una página (LOT 28: la página 2 es solo el pie). Se separa por el encabezado "Vendor Notice", no por página.
- Encabezado: `Lot/Unit · Phase · Plan · Tract · Elevation` + `Work Order`.
- Línea: fecha · code (`2FIN5006`) · Reference# · cantidad · precio unitario · total.
- Debajo: descripción (1 a 3 líneas), `Stage`, y "Revised on … Cost has changed from $X to $Y".
- Negativos entre paréntesis: `($14.00)`.
- Un Work Order puede traer total (LOT 28: `$2,222.00` = 1,935 + 287), útil como checksum.

Resultado esperado de los fixtures (se usará en los tests):

| Archivo | Lot | Phase | Plan | Code | Precio |
|---|---|---|---|---|---|
| olson-lot-27.pdf | 27 | MDL | 4 | 2FIN5006 | $81.00 |
| | 27 | MDL | 4 | 1STR0024 | $1,126.00 |
| | 27 | MDL | 4 | 2CAB3033 | -$14.00 |
| olson-lot-28.pdf | 28 | MDL | 2 | 2FIN7002 | $1,935.00 |
| | 28 | MDL | 2 | 2WRD0009 | $287.00 |

## 3. Cómo encaja con lo que ya existe

- `job_documents` ya acepta `PURCHASE_ORDER` (bucket privado, PDF, 25 MB).
- El patrón de análisis ya existe: `payment-schedule-analyze` (autoriza con el JWT, descarga con service role,
  guarda `needs_review`, una persona confirma). Se reutiliza `releasePdf.ts` (`unpdf`/pdf.js) para el texto.
- Modelo de options: `plan_options` (por **Plan**, code + nombre + descripción), `option_prices` (vigencias),
  `lot_options` (qué options tiene cada Lot).
- **Importante:** desde `phase_pinned_prices` cada `lot_options` tiene `option_price_id` fijado. El precio
  "del sistema" para comparar es el que el Lot **realmente factura** (`lot_options.option_price_id`), y si es
  `NULL` el precio vigente.
- Un Plan puede tener el **mismo code más de una vez** si describe trabajos distintos (migración phase 6).
  Por eso code solo no basta para identificar una option: se desempata con la descripción.
- Precios negativos y "precio no aplica" ya están soportados.

## 4. Arquitectura

### 4.1 Parser (puro, sin base de datos) — `functions/_shared/purchaseOrder/`

| Archivo | Responsabilidad |
|---|---|
| `poTypes.ts` | Tipo canónico `ParsedPurchaseOrder` (igual para cualquier builder) |
| `poParserOlson.ts` | Parser determinista del formato Olson |
| `poParsers.ts` | Registro de parsers; detecta el formato por firma de texto ("Vendor Notice", "The Olson Company") |
| `poNormalize.ts` | Normalización de Phase / Plan / Lot / code / descripción |
| `poMatch.ts` | Emparejamiento y similitud |
| `*.test.ts` | Tests con fixtures y con texto sintético |

Tipo canónico (lo único que el resto del sistema conoce):

```
ParsedPurchaseOrder {
  parser, pageCount,
  workOrders: [{ workOrderNo, lotRaw, phaseRaw, planRaw, tract, elevation, declaredTotal,
    lines: [{ optionCodeRaw, referenceNo, date, revisedOn, quantity, unitPrice, total,
              descriptionLines[], previousCost }] }],
  issues: [{ code, message, page?, workOrderNo? }]
}
```

Validaciones del parser (generan `issues`, no excepciones): `quantity × unitPrice = total`, suma de líneas =
total declarado, línea sin code, formato no reconocido.

Otros builders (otro layout, misma información): se añade otro parser que produzca el mismo tipo. Si el
formato no se reconoce, fallback opcional a **LLM** (Mistral, ya configurado) que devuelve el mismo JSON y se
verifica que cada code y monto aparezca literalmente en el texto del PDF. Va en la última etapa.

### 4.2 Normalización y similitud

Orden de emparejamiento, siempre de más a menos estricto, **sin elegir en silencio cuando hay duda**:

1. **Normalizado exacto.** Minúsculas, sin acentos/puntuación, se quitan las palabras `phase`, `fase`, `ph`,
   `plan`, `lot`, `unit`, `#` y ceros a la izquierda; singular/plural. `Model`, `Models`, `MDL` →
   alias de modelo; `Phase 4` y `4` → `4`.
2. **Alias aprendidos** por Job (tabla `purchase_order_aliases`): si un usuario resuelve a mano "Models → MDL",
   se recuerda para los siguientes PDFs.
3. **Similitud** (coeficiente de Dice sobre tokens/bigramas) con umbral. Si hay **un único** candidato sobre el umbral
   alto se propone como "sugerido"; si hay empate o queda bajo el umbral, el usuario elige de una lista.
4. El **Lot** se desambigua con el Plan: el mismo número de lot puede existir en dos Phases.

Para las **options**:

- **Code:** mayúsculas y sin separadores (`2FIN-5006` = `2FIN5006`).
- **Descripción** (punto 4 de tus respuestas): se normaliza y se compara por similitud. Se usa para
  (a) desempatar cuando hay varios `plan_options` con el mismo code, y
  (b) avisar cuando el code coincide pero el trabajo parece otro (similitud baja).
  Para el nombre de una option nueva se usa la primera línea de la descripción del PO, y el resto va como descripción.

### 4.3 Base de datos (una migración, mismo estilo que `payment_schedule_templates`)

- `valtrim.purchase_order_analyses` — una fila por `job_documents` (`unique`, `on delete cascade`).
  Estados `analyzing | needs_review | reviewed | failed | not_option_po`, `parser`, `page_count`, `issues jsonb`,
  `error`, `requested_by`, `analyzed_at`. Un trigger valida que el documento sea `PURCHASE_ORDER`.
- `valtrim.purchase_order_lines` — una fila por línea del PO: Work Order, lot/phase/plan crudos, code crudo y
  normalizado, Reference#, fechas, cantidad, precio unitario, total, descripción, y los ids resueltos
  (`lot_id`, `plan_id`, `plan_option_id`) que se rellenan al emparejar o al resolver a mano.
  No se guarda el texto completo del PDF (mismo criterio que los otros análisis).
- `valtrim.purchase_order_aliases` — alias aprendidos por Job (tipo, valor normalizado, destino).
- **Vista `purchase_order_current_lines`:** deja una sola línea por (Lot, code) — la **más reciente** por
  `revised_on`, luego `po_date`, luego `reference_no` (es creciente). Así "gana la revisión más nueva" y los
  PDFs viejos se conservan como historial. Subir dos veces el mismo PDF es idempotente (clave Work Order + Reference#).
- **RPC de comparación** `valtrim.compare_purchase_orders(p_job_id)`: calcula en el momento (no se guarda, porque
  los precios cambian) y devuelve por línea el estado:

| Estado | Condición |
|---|---|
| `MATCH` | Code existe en el Plan, está en el Lot, mismo precio |
| `PRICE_DIFF` | Mismo code, precio distinto (sistema vs PO) |
| `MISSING_OPTION` | El Plan no tiene esa option → se puede crear |
| `NOT_IN_LOT` | Existe en el Plan, pero el Lot no la tiene en `lot_options` |
| `HEADER_UNRESOLVED` | Lot/Phase/Plan del PDF no se pudo emparejar → el usuario elige |
| `AMBIGUOUS_OPTION` | Varios `plan_options` con ese code y descripción poco clara |
| `NO_PO` (inversa) | El Lot tiene el PO cargado pero esta option del sistema no aparece en él |

  La inversa solo se evalúa en Lots **que ya tienen al menos un PO**; los Lots sin ningún PO se resumen aparte
  ("12 lots sin PO") para no llenar de falsas alarmas.
- **RPC de importación** `valtrim.import_purchase_order_options(p_line_ids bigint[])` (`security definer`,
  solo ADMIN y PROJECT_MANAGEMENT): en una transacción crea `plan_options`, su precio (con `set_option_price`)
  y la fila de `lot_options` con el precio fijado. Idempotente. **Salta y reporta** los Lots cuyo Phase ya tiene
  Packages facturados.
- **Permisos:** el análisis lo dispara ADMIN / ACCOUNTING / PROJECT_MANAGEMENT (como Payment Schedules);
  los navegadores nunca escriben las tablas, solo la edge function (service role) y las RPC. La lectura de
  precios de PO sigue la misma regla que hoy rige los precios de options (se verifica antes de implementar).

### 4.4 Edge function `purchase-order-analyze`

Copia el esqueleto de `payment-schedule-analyze`: JWT + rol → descarga el PDF privado con service role →
`parsePurchaseOrder` → empareja → guarda `needs_review` → nada del documento se loguea.
Entrada: `{ job_document_id, force? }`. Si el PDF no se reconoce como PO de options (por ejemplo una matriz de
PO de pagos), termina en `not_option_po` sin error.

### 4.5 Frontend — `features/purchase-orders/`

- **Documents → Purchase Orders:** tras subir, se dispara el análisis. Cada archivo muestra un chip
  ("5 lines · 1 price differs · 1 to review") y un botón **Review**.
- **Diálogo de revisión** por PO: tabla Lot / Code / Descripción / Precio PO / Precio sistema / Estado.
  Encabezados sin resolver → selector con la sugerencia preseleccionada. Acciones por fila:
  - **Create option** (y asignarla al Lot) cuando falta; también "Create all missing" con confirmación.
  - **Use PO price** cuando el precio difiere: es una **sugerencia** con un diálogo de confirmación.
- **Packages (`SelectableOptionsTable`):** insignia por option (Respaldada por PO / Precio distinto / Sin PO) y
  un aviso arriba con los conteos. Solo informa; nunca deshabilita el botón de crear.

## 5. Decisión de diseño que necesito que confirmes: "Usar precio del PO"

El precio de una option es **por Plan**, y cada Lot lo tiene **fijado** (`pinned`) desde que se creó su Phase.
Entonces "Use PO price" no es un simple update. Propongo un diálogo de dos pasos, ambos explícitos:

1. Fijar el nuevo precio de la option con `set_option_price` (afecta a los Phases que se creen **después**).
2. Aplicarlo al Lot de este PO con el flujo que ya existe, `preview_phase_price_changes` /
   `apply_phase_price_changes`, que exige un motivo (se pre-llena con "Purchase Order <Work Order>") y no toca
   lo que ya se facturó.

Si dos POs del mismo Plan traen precios distintos para el mismo code, el diálogo lo advierte, porque el paso 1
cambiaría el precio de todo el Plan.

## 6. Pruebas

- **Deno:** parser contra los 2 fixtures (valores de la tabla de arriba, checksum de $2,222.00, negativo
  `($14.00)`, separación por "Vendor Notice"); normalización (`Model/Models/MDL`, `Phase 4/4`, `Lot 027/27`);
  similitud de descripciones; texto sintético sin datos reales para que corra en CI aun sin los fixtures privados.
- **pgTAP:** cada estado de comparación, la vista de "más reciente gana", idempotencia de la importación,
  salto de Phases ya facturados, permisos por rol.
- **Frontend:** mapeadores de registros y la lógica de insignias.

## 7. Etapas (cada una es una feature cerrable)

| # | Etapa | Entrega |
|---|---|---|
| 1 | Parser Olson + normalización + tests | Código puro, sin tocar base ni UI |
| 2 | Migración + edge function + RPC de comparación + pgTAP | Análisis guardado y comparable |
| 3 | UI de revisión en Documents | Ver líneas, estados, resolver encabezados |
| 4 | Importar options faltantes | RPC + diálogo |
| 5 | "Use PO price" (sugerencia en dos pasos) | Diálogo + reuso de recalculation |
| 6 | Insignias en Packages | Aviso informativo |
| 7 | Segundo builder / fallback LLM | Cuando llegue el primer PDF de otro layout |

## 8. Decisiones tomadas

1. **Purchase Orders = solo POs de options.** Las Payment Schedules / PO Matrix van en su propia sección.
   Un PDF que no sea un PO de options termina en `not_option_po`, nunca en un error.
2. **El precio de una option es por Plan.** No puede costar distinto en Lots distintos. Si dos POs del mismo
   Plan traen precios distintos para el mismo code, es una discrepancia del PO y se avisa.
3. **Phases con Packages facturados:** la importación no las toca; se saltan y se reportan.
4. **Nombres reales del sistema:** la Phase se llama `MODELS` (el PDF dice `MDL`) y el Plan es **Plan + Elevation**
   (`4` + `B` = `4B`; la plataforma no maneja elevation por separado).
5. **Los precios del PO los ven los mismos roles que ya ven precios de options.**
6. **Stage del PO:** se ignora.
7. **Otros builders:** otro layout, misma información → un parser por builder sobre el mismo tipo canónico.

## 9. Avance

| Etapa | Estado |
|---|---|
| 1. Parser Olson + normalización + emparejamiento + tests | **Hecha** (`_shared/purchaseOrder*.ts`, 17 tests) |
| 2. Migración + edge function + RPC de comparación | Pendiente |
| 3. UI de revisión en Documents | Pendiente |
| 4. Importar options faltantes | Pendiente |
| 5. "Use PO price" | Pendiente |
| 6. Insignias en Packages | Pendiente |
| 7. Segundo builder / fallback LLM | Pendiente |

Notas de la etapa 1:

- Con los PDFs reales apareció que "Revised by …" comparte fila con la primera línea de la descripción; el
  parser lo separa.
- `MDL` → `MODELS` se resuelve como **sugerida** (abreviatura), no como coincidencia automática: el revisor la
  confirma una vez y queda como alias del Job. `Model` y `Models` sí coinciden solos (singular/plural).
- Los Plans y los Lots nunca se emparejan por parecido (`4B` no se confunde con `4C`).
