import { assertEquals, assertThrows } from '@std/assert'
import { buildQuickbooksInvoicePayload, QuickbooksInvoiceError } from './quickbooksInvoice.ts'
import {
  mapPackageToCharges,
  type PackageAdjustmentLineRow,
  type PackageDrawRow,
  type PackageHardwareLineRow,
  type PackageInvoiceSource,
  type PackageOptionRow,
} from './quickbooksPackageCharges.ts'

const header = { package_type: 'DRAW', status: 'DRAFT', invoice_line_format: 'LOT_SCOPE' }

const draw = (patch: Partial<PackageDrawRow>): PackageDrawRow => ({
  lot_number: '1',
  phase_code: '1',
  building: '1',
  draw_number: 1,
  is_utility_building: false,
  utility_name: null,
  utility_event_type: null,
  utility_amount: 0,
  base_draw_amount: 0,
  hardware_amount: 0,
  hardware_event_type: null,
  options_amount: 0,
  retention_amount: 0,
  wrap_amount: 0,
  ...patch,
})

const hardwareLine = (patch: Partial<PackageHardwareLineRow>): PackageHardwareLineRow => ({
  lot_number: '1',
  phase_code: '1',
  building: '1',
  hardware_event_type: 'HW',
  hardware_amount: 0,
  retention_amount: 0,
  wrap_amount: 0,
  ...patch,
})

const invoiceFor = (source: PackageInvoiceSource) => {
  const mapped = mapPackageToCharges(source)
  return buildQuickbooksInvoicePayload({
    customerId: '1',
    itemId: '19',
    txnDate: '2026-10-09',
    ...mapped,
  })
}

// DP-00000068 from ValtrimBillingTestV2: Utility Building, hardware billed by
// event and retention only.
const utilityPackage: PackageInvoiceSource = {
  package: header,
  draws: [
    draw({ lot_number: '1', base_draw_amount: '800.00', retention_amount: '40.00' }),
    draw({ lot_number: '2', base_draw_amount: '600.00', retention_amount: '30.00' }),
    draw({
      lot_number: 'UTILITY-1',
      is_utility_building: true,
      utility_name: 'B1',
      utility_event_type: 'EXT',
      utility_amount: '750.00',
      retention_amount: '37.50',
    }),
  ],
  hardwareLines: [
    hardwareLine({ lot_number: '1', hardware_amount: '500.00', retention_amount: '25.00' }),
    hardwareLine({ lot_number: '2', hardware_amount: '500.00', retention_amount: '25.00' }),
  ],
  invoice: { net_amount: '2992.50' },
}

Deno.test('maps draws, utility and hardware lines to one row each, plus retention', () => {
  const payload = invoiceFor(utilityPackage)

  assertEquals(
    payload.Line.map((row) => [row.Description, row.Amount]),
    [
      ['PHASE 1 LOTS #1-2\nDRAW 1', 1400],
      ['PHASE 1 LOTS #1-2\nHARDWARE - HW', 1000],
      ['PHASE 1 B1\nUTILITY - EXT', 750],
      ['RETENTION', -157.5],
    ],
  )
})

// DP-00000069: two phases, options on one lot and wrap only.
Deno.test('maps a multi phase package with options and wrap', () => {
  const lots = ['1', '2', '3', '4', '5']
  const phase5 = lots.flatMap((lot) => [
    draw({
      lot_number: lot,
      phase_code: '5',
      building: '8',
      draw_number: 1,
      base_draw_amount: 625,
      wrap_amount: 12.5,
    }),
    draw({
      lot_number: lot,
      phase_code: '5',
      building: '8',
      draw_number: 2,
      base_draw_amount: 1500,
      options_amount: lot === '1' ? 900 : 0,
      wrap_amount: lot === '1' ? 48 : 30,
    }),
  ])
  const phase6 = [
    draw({
      phase_code: '6',
      building: '7',
      draw_number: 1,
      base_draw_amount: 625,
      wrap_amount: 12.5,
    }),
    draw({
      phase_code: '6',
      building: '7',
      draw_number: 2,
      base_draw_amount: 1500,
      wrap_amount: 30,
    }),
  ]

  const payload = invoiceFor({
    package: header,
    draws: [...phase5, ...phase6],
    hardwareLines: [],
    invoice: { net_amount: 13377 },
  })

  assertEquals(
    payload.Line.map((row) => [row.Description, row.Amount]),
    [
      ['PHASE 5 LOTS #1-5\nDRAW 1', 3125],
      ['PHASE 5 LOTS #1-5\nDRAW 2', 7500],
      ['PHASE 5 LOT #1\nOPTIONS', 900],
      ['PHASE 6 LOT #1\nDRAW 1', 625],
      ['PHASE 6 LOT #1\nDRAW 2', 1500],
      ['WRAP', -273],
    ],
  )
})

Deno.test('hardware billed in full on the draw row gets a plain HARDWARE row', () => {
  const payload = invoiceFor({
    package: header,
    draws: [draw({ base_draw_amount: 1000, hardware_amount: 200 })],
    hardwareLines: [],
    invoice: { net_amount: 1200 },
  })

  assertEquals(payload.Line.map((row) => row.Description), [
    'PHASE 1 LOT #1\nDRAW 1',
    'PHASE 1 LOT #1\nHARDWARE',
  ])
})

Deno.test('refuses a package whose invoice total differs from its rows', () => {
  const error = assertThrows(
    () => invoiceFor({ ...utilityPackage, invoice: { net_amount: '3000.00' } }),
    QuickbooksInvoiceError,
  )
  assertEquals(error.code, 'TOTAL_MISMATCH')
})

Deno.test('refuses retention releases, voided packages and packages without invoice', () => {
  const code = (source: PackageInvoiceSource) =>
    assertThrows(() => mapPackageToCharges(source), QuickbooksInvoiceError).code

  assertEquals(
    code({ ...utilityPackage, package: { ...header, package_type: 'RETENTION_RELEASE' } }),
    'UNSUPPORTED_PACKAGE',
  )
  assertEquals(
    code({ ...utilityPackage, package: { ...header, status: 'VOIDED' } }),
    'UNSUPPORTED_PACKAGE',
  )
  assertEquals(code({ ...utilityPackage, invoice: null }), 'INVALID_INPUT')
})

Deno.test('requires a utility name on utility rows', () => {
  const error = assertThrows(
    () =>
      mapPackageToCharges({
        ...utilityPackage,
        draws: [draw({ is_utility_building: true, utility_amount: 10 })],
      }),
    QuickbooksInvoiceError,
  )
  assertEquals(error.code, 'INVALID_INPUT')
})

// A Price Adjustment Package: what two earlier Packages (DP-00000035 and
// DP-00000036) would have billed at the new price, minus what they billed.
const adjustmentHeader = {
  package_type: 'PRICE_ADJUSTMENT',
  status: 'DRAFT',
  invoice_line_format: 'LOT_SCOPE',
}

const adjustmentLine = (patch: Partial<PackageAdjustmentLineRow>): PackageAdjustmentLineRow => ({
  source_package_number: 'DP-00000035',
  line_kind: 'DRAW',
  lot_number: '12',
  phase_code: '1',
  building: '1',
  draw_number: 2,
  hardware_event_type: null,
  gross: 0,
  retention: 0,
  wrap: 0,
  ...patch,
})

const adjustmentPackage = (
  lines: PackageAdjustmentLineRow[],
  netAmount: string,
): PackageInvoiceSource => ({
  package: adjustmentHeader,
  draws: [],
  hardwareLines: [],
  adjustmentLines: lines,
  invoice: { net_amount: netAmount },
})

Deno.test('a Price Adjustment lists each source Package and Draw, lots grouped, then Retention and WRAP', () => {
  const payload = invoiceFor(adjustmentPackage([
    adjustmentLine({ lot_number: '12', gross: '100.00', retention: '5.00', wrap: '2.00' }),
    adjustmentLine({ lot_number: '13', gross: '100.00', retention: '5.00', wrap: '2.00' }),
    adjustmentLine({ lot_number: '12', draw_number: 3, gross: '50.00', retention: '2.50', wrap: '1.00' }),
    adjustmentLine({
      source_package_number: 'DP-00000036',
      lot_number: '20',
      gross: '40.00',
      retention: '2.00',
      wrap: '0.80',
    }),
  ], '269.70'))

  assertEquals(
    payload.Line.map((row) => [row.Description, row.Amount]),
    [
      ['PHASE 1 LOTS #12-13\nPRICE ADJUSTMENT DP-00000035 · DRAW 2', 200],
      ['PHASE 1 LOT #12\nPRICE ADJUSTMENT DP-00000035 · DRAW 3', 50],
      ['PHASE 1 LOT #20\nPRICE ADJUSTMENT DP-00000036 · DRAW 2', 40],
      ['RETENTION', -14.5],
      ['WRAP', -5.8],
    ],
  )
})

Deno.test('a credit inside an adjustment is a negative line and the total still matches', () => {
  const payload = invoiceFor(adjustmentPackage([
    adjustmentLine({ lot_number: '12', draw_number: 1, gross: '400.00', retention: '20.00', wrap: '8.00' }),
    adjustmentLine({ lot_number: '12', draw_number: 2, gross: '-250.00', retention: '-12.50', wrap: '-5.00' }),
  ], '139.50'))

  assertEquals(
    payload.Line.map((row) => [row.Description, row.Amount]),
    [
      ['PHASE 1 LOT #12\nPRICE ADJUSTMENT DP-00000035 · DRAW 1', 400],
      ['PHASE 1 LOT #12\nPRICE ADJUSTMENT DP-00000035 · DRAW 2', -250],
      ['RETENTION', -7.5],
      ['WRAP', -3],
    ],
  )
})

Deno.test('adjustment lines that cancel each other out leave no empty line', () => {
  const payload = invoiceFor(adjustmentPackage([
    adjustmentLine({ lot_number: '12', gross: '100.00', retention: '5.00', wrap: '2.00' }),
    adjustmentLine({ lot_number: '13', gross: '-100.00', retention: '-5.00', wrap: '-2.00' }),
    adjustmentLine({ lot_number: '14', draw_number: 4, gross: '60.00', retention: '3.00', wrap: '1.20' }),
  ], '55.80'))

  assertEquals(payload.Line.map((row) => row.Description), [
    'PHASE 1 LOT #14\nPRICE ADJUSTMENT DP-00000035 · DRAW 4',
    'RETENTION',
    'WRAP',
  ])
})

Deno.test('a Price Adjustment names Separate Hardware by its event', () => {
  const payload = invoiceFor(adjustmentPackage([
    adjustmentLine({
      line_kind: 'HARDWARE_EVENT',
      draw_number: null,
      hardware_event_type: 'EXT',
      gross: '120.00',
      retention: '6.00',
      wrap: '2.40',
    }),
  ], '111.60'))

  assertEquals(payload.Line.map((row) => row.Description), [
    'PHASE 1 LOT #12\nPRICE ADJUSTMENT DP-00000035 · HARDWARE EXT',
    'RETENTION',
    'WRAP',
  ])
})

Deno.test('a Utility row in an adjustment is named, not numbered', () => {
  const payload = invoiceFor(adjustmentPackage([
    adjustmentLine({
      lot_number: 'UTILITY-1',
      is_utility_building: true,
      utility_name: 'Clubhouse',
      draw_number: 1,
      gross: '137.55',
      retention: '6.88',
      wrap: '2.75',
    }),
  ], '127.92'))

  assertEquals(payload.Line.map((row) => [row.Description, row.Amount]), [
    ['PHASE 1 CLUBHOUSE\nPRICE ADJUSTMENT DP-00000035 · DRAW 1', 137.55],
    ['RETENTION', -6.88],
    ['WRAP', -2.75],
  ])

  const error = assertThrows(
    () =>
      mapPackageToCharges(adjustmentPackage([
        adjustmentLine({ lot_number: 'UTILITY-1', is_utility_building: true, utility_name: ' ', gross: 10 }),
      ], '10')),
    QuickbooksInvoiceError,
  )
  assertEquals(error.code, 'INVALID_INPUT')
})

Deno.test('the building format groups an adjustment by Building like any other Package', () => {
  const mapped = mapPackageToCharges({
    ...adjustmentPackage([
      adjustmentLine({ lot_number: '1', building: 'C5', gross: 100 }),
      adjustmentLine({ lot_number: '2', building: 'C5', gross: 100 }),
      adjustmentLine({ lot_number: '3', building: 'C6', gross: 100 }),
    ], '300'),
    package: { ...adjustmentHeader, invoice_line_format: 'BUILDING_SCOPE' },
  })
  const payload = buildQuickbooksInvoicePayload({
    customerId: '1',
    itemId: '19',
    txnDate: '2026-10-09',
    ...mapped,
  })

  assertEquals(payload.Line.map((row) => [row.Description, row.Amount]), [
    ['PHASE 1 BUILDING C5 LOTS #1-2\nPRICE ADJUSTMENT DP-00000035 · DRAW 2', 200],
    ['PHASE 1 BUILDING C6 LOT #3\nPRICE ADJUSTMENT DP-00000035 · DRAW 2', 100],
  ])
})

Deno.test('an adjustment that is not what its invoice says is refused', () => {
  const code = (source: PackageInvoiceSource) =>
    assertThrows(() => invoiceFor(source), QuickbooksInvoiceError).code

  const lines = [adjustmentLine({ gross: '100.00', retention: '5.00', wrap: '2.00' })]

  assertEquals(code(adjustmentPackage(lines, '200.00')), 'TOTAL_MISMATCH')
  assertEquals(code({ ...adjustmentPackage(lines, '93.00'), invoice: null }), 'INVALID_INPUT')
  assertEquals(code(adjustmentPackage([], '93.00')), 'INVALID_INPUT')
  assertEquals(
    code({ ...adjustmentPackage(lines, '93.00'), draws: [draw({ base_draw_amount: 10 })] }),
    'INVALID_INPUT',
  )
  assertEquals(
    code({ ...adjustmentPackage(lines, '93.00'), package: { ...adjustmentHeader, status: 'VOIDED' } }),
    'UNSUPPORTED_PACKAGE',
  )
  // Retention that adds up to a negative amount cannot be shown as a negative line.
  assertEquals(
    code(adjustmentPackage([
      adjustmentLine({ gross: '100.00', retention: '-5.00', wrap: '2.00' }),
    ], '103.00')),
    'INVALID_INPUT',
  )
})

Deno.test('a Retention Release is still not sent to QuickBooks', () => {
  const error = assertThrows(
    () =>
      mapPackageToCharges({
        ...adjustmentPackage([adjustmentLine({ gross: 10 })], '10'),
        package: { ...adjustmentHeader, package_type: 'RETENTION_RELEASE' },
      }),
    QuickbooksInvoiceError,
  )
  assertEquals(error.code, 'UNSUPPORTED_PACKAGE')
})

const optionRow = (patch: Partial<PackageOptionRow>): PackageOptionRow => ({
  lot_number: '1',
  phase_code: '1',
  building: null,
  option_price: 0,
  ...patch,
})

// DP-00000109 (Job 1236): four Lots with options. The Package charges every option on the line of
// the first Lot, but the options belong to Lots 26, 27, 40 and 41.
const buildingScope = { ...header, invoice_line_format: 'BUILDING_SCOPE' }
const dp109 = (optionLines: PackageOptionRow[] | undefined): PackageInvoiceSource => {
  const lots: Array<[string, number, number, number]> = [
    ['26', 1204.75, 3132.35, 481.9],
    ['27', 1262.5, 3282.5, 505],
    ['40', 1259.75, 3275.35, 503.9],
    ['41', 1002.75, 2607.15, 401.1],
  ]
  return {
    package: buildingScope,
    draws: lots.flatMap(([lot, one, two, three]) => [
      draw({ lot_number: lot, phase_code: 'L9-25A', building: null, draw_number: 1, base_draw_amount: one }),
      draw({
        lot_number: lot,
        phase_code: 'L9-25A',
        building: null,
        draw_number: 2,
        base_draw_amount: two,
        options_amount: lot === '26' ? 3572 : 0,
      }),
      draw({ lot_number: lot, phase_code: 'L9-25A', building: null, draw_number: 3, base_draw_amount: three }),
    ]),
    hardwareLines: [],
    ...(optionLines ? { optionLines } : {}),
    invoice: { net_amount: '22491.00' },
  }
}
const dp109Options = [
  { lot: '26', prices: [913, 798, -64, -126] },
  { lot: '27', prices: [766, 264] },
  { lot: '40', prices: [255] },
  { lot: '41', prices: [766] },
].flatMap(({ lot, prices }) =>
  prices.map((price) => optionRow({ lot_number: lot, phase_code: 'L9-25A', option_price: price }))
)

Deno.test('the OPTIONS line names every Lot whose options it bills, not only the Lot it is charged on', () => {
  // Lot 26 holds 1521 in options (a credit among them) and the other Lots the rest: 3572 in all.
  const rows = [
    ...dp109Options.filter((row) => row.lot_number === '26'),
    ...dp109Options.filter((row) => row.lot_number !== '26'),
  ]
  assertEquals(rows.reduce((sum, row) => sum + Number(row.option_price), 0), 3572)

  const payload = invoiceFor(dp109(rows))
  assertEquals(
    payload.Line.map((line) => [line.Description, line.Amount]),
    [
      ['PHASE L9-25A LOTS #26-27, 40-41\nDRAW 1', 4729.75],
      ['PHASE L9-25A LOTS #26-27, 40-41\nDRAW 2', 12297.35],
      ['PHASE L9-25A LOTS #26-27, 40-41\nDRAW 3', 1891.9],
      ['PHASE L9-25A LOTS #26-27, 40-41\nOPTIONS', 3572],
    ],
  )
})

Deno.test('a Lot whose options cancel out is left off the OPTIONS line', () => {
  const rows = [
    optionRow({ lot_number: '26', phase_code: 'L9-25A', option_price: 3572 }),
    optionRow({ lot_number: '27', phase_code: 'L9-25A', option_price: 64 }),
    optionRow({ lot_number: '27', phase_code: 'L9-25A', option_price: -64 }),
  ]

  const payload = invoiceFor(dp109(rows))
  assertEquals(
    payload.Line.find((line) => line.Description.endsWith('OPTIONS'))?.Description,
    'PHASE L9-25A LOT #26\nOPTIONS',
  )
})

Deno.test('option rows that do not add up to the lines leave the invoice as the lines bill it', () => {
  // Rows worth 3000 against 3572 billed: the amounts of the lines win, so the total is never changed.
  const rows = [optionRow({ lot_number: '26', phase_code: 'L9-25A', option_price: 2000 }),
    optionRow({ lot_number: '27', phase_code: 'L9-25A', option_price: 1000 })]

  const payload = invoiceFor(dp109(rows))
  assertEquals(
    payload.Line.find((line) => line.Description.endsWith('OPTIONS')),
    {
      Amount: 3572,
      DetailType: 'SalesItemLineDetail',
      Description: 'PHASE L9-25A LOT #26\nOPTIONS',
      SalesItemLineDetail: { ItemRef: { value: '19' }, Qty: 1, UnitPrice: 3572 },
    },
  )
})

Deno.test('a Package without option rows keeps charging the options of each line', () => {
  const payload = invoiceFor(dp109(undefined))
  assertEquals(
    payload.Line.find((line) => line.Description.endsWith('OPTIONS'))?.Description,
    'PHASE L9-25A LOT #26\nOPTIONS',
  )
})

Deno.test('options of Lots in another Phase get their own OPTIONS line there', () => {
  const rows = [
    optionRow({ lot_number: '26', phase_code: 'L9-25A', option_price: 2000 }),
    optionRow({ lot_number: '27', phase_code: 'L9-25A', option_price: 1000 }),
    optionRow({ lot_number: '5', phase_code: 'L9-26', option_price: 572 }),
  ]

  const payload = invoiceFor(dp109(rows))
  assertEquals(
    payload.Line.filter((line) => line.Description.endsWith('OPTIONS')).map((line) => [
      line.Description,
      line.Amount,
    ]),
    [
      ['PHASE L9-25A LOTS #26-27\nOPTIONS', 3000],
      ['PHASE L9-26 LOT #5\nOPTIONS', 572],
    ],
  )
})

// A Package of Options only: OP-… bills Options of Lots that already reached the Options Draw, with no
// Lot / Draw cell. It withholds retention and WRAP Option by Option.
const optionsHeader = { package_type: 'OPTIONS', status: 'DRAFT', invoice_line_format: 'LOT_SCOPE' }
const optionsPackage = (
  optionLines: PackageOptionRow[],
  net: string,
  patch: Partial<PackageInvoiceSource> = {},
): PackageInvoiceSource => ({
  package: optionsHeader,
  draws: [],
  hardwareLines: [],
  optionLines,
  invoice: { net_amount: net },
  ...patch,
})

Deno.test('an Options Package is invoiced with an OPTIONS line per Phase naming its Lots, and what it withheld', () => {
  const rows = [
    optionRow({ lot_number: '26', phase_code: '1', option_price: 1000, retention_amount: '50.00', wrap_amount: '15.00' }),
    optionRow({ lot_number: '26', phase_code: '1', option_price: 250, retention_amount: '12.50', wrap_amount: '3.75' }),
    optionRow({ lot_number: '27', phase_code: '1', option_price: 750, retention_amount: '37.50', wrap_amount: '11.25' }),
  ]

  const mapped = mapPackageToCharges(optionsPackage(rows, '1870.00'))
  assertEquals(mapped.retentionAmount, 100)
  assertEquals(mapped.wrapAmount, 30)
  assertEquals(mapped.expectedNetAmount, 1870)
  assertEquals(mapped.charges.map((charge) => [charge.lotNumber, charge.kind, charge.amount]), [
    ['26', 'OPTIONS', 1250],
    ['27', 'OPTIONS', 750],
  ])

  const payload = invoiceFor(optionsPackage(rows, '1870.00'))
  assertEquals(payload.Line.map((line) => [line.Description, line.Amount]), [
    ['PHASE 1 LOTS #26-27\nOPTIONS', 2000],
    ['RETENTION', -100],
    ['WRAP', -30],
  ])
})

Deno.test('an Options Package of Lots in several Phases gets a line in each', () => {
  const rows = [
    optionRow({ lot_number: '4', phase_code: '1', option_price: 500 }),
    optionRow({ lot_number: '9', phase_code: '2', option_price: 300 }),
  ]

  const payload = invoiceFor(optionsPackage(rows, '800.00'))
  assertEquals(payload.Line.map((line) => [line.Description, line.Amount]), [
    ['PHASE 1 LOT #4\nOPTIONS', 500],
    ['PHASE 2 LOT #9\nOPTIONS', 300],
  ])
})

Deno.test('an Options Package that is not what its invoice says is refused', () => {
  const rows = [optionRow({ lot_number: '26', phase_code: '1', option_price: 1000, retention_amount: '50.00' })]

  const error = assertThrows(() => invoiceFor(optionsPackage(rows, '900.00')), QuickbooksInvoiceError)
  assertEquals(error.code, 'TOTAL_MISMATCH')
})

Deno.test('an Options Package needs options and cannot carry Draw or Hardware lines', () => {
  assertEquals(
    assertThrows(() => mapPackageToCharges(optionsPackage([], '0')), QuickbooksInvoiceError).code,
    'INVALID_INPUT',
  )
  const rows = [optionRow({ lot_number: '26', phase_code: '1', option_price: 1000 })]
  assertEquals(
    assertThrows(
      () => mapPackageToCharges(optionsPackage(rows, '1000', { draws: [draw({ base_draw_amount: 10 })] })),
      QuickbooksInvoiceError,
    ).code,
    'INVALID_INPUT',
  )
})

Deno.test('an Options Package whose retention adds up to a negative amount is refused', () => {
  const rows = [
    optionRow({ lot_number: '26', phase_code: '1', option_price: 10, retention_amount: '-0.50' }),
  ]

  const error = assertThrows(() => mapPackageToCharges(optionsPackage(rows, '10.50')), QuickbooksInvoiceError)
  assertEquals(error.code, 'INVALID_INPUT')
})

// A Draw Package that carries price differences of earlier Packages next to its own lines: one
// "PRICE ADJUSTMENT" row for each, named after its Phase, Lot and Draw.
const drawWithDifferences = (
  lines: PackageAdjustmentLineRow[],
  netAmount: string,
  format = 'LOT_SCOPE',
): PackageInvoiceSource => ({
  package: { ...header, invoice_line_format: format },
  draws: [
    draw({ phase_code: 'MODELS', building: null, lot_number: '2', draw_number: 2, base_draw_amount: '2683.85' }),
    draw({ phase_code: 'MODELS', building: null, lot_number: '4', draw_number: 2, base_draw_amount: '2973.10' }),
  ],
  hardwareLines: [],
  adjustmentLines: lines,
  invoice: { net_amount: netAmount },
})

const priceDifference = (patch: Partial<PackageAdjustmentLineRow>): PackageAdjustmentLineRow =>
  adjustmentLine({ phase_code: 'MODELS', building: null, draw_number: 1, ...patch })

Deno.test('a Draw Package adds one row for each price difference it carries, after its own lines', () => {
  const payload = invoiceFor(drawWithDifferences([
    priceDifference({ lot_number: '2', gross: '-75.00' }),
    priceDifference({ lot_number: '4', gross: '-79.75' }),
  ], '5502.20'))

  assertEquals(
    payload.Line.map((row) => [row.Description, row.Amount]),
    [
      ['PHASE MODELS LOTS #2, 4\nDRAW 2', 5656.95],
      ['PRICE ADJUSTMENT PHASE MODELS LOT 2 · DRAW 1', -75],
      ['PRICE ADJUSTMENT PHASE MODELS LOT 4 · DRAW 1', -79.75],
    ],
  )
})

Deno.test('the rows of price differences are never grouped, even for lots in the same Draw', () => {
  const payload = invoiceFor(drawWithDifferences([
    priceDifference({ lot_number: '2', gross: '10.00' }),
    priceDifference({ lot_number: '4', gross: '10.00' }),
  ], '5676.95'))

  assertEquals(payload.Line.length, 3)
})

Deno.test('the retention and WRAP of the differences join the Package totals', () => {
  const source = drawWithDifferences([
    priceDifference({ lot_number: '2', gross: '100.00', retention: '10.00', wrap: '5.00' }),
  ], '5721.95')
  source.draws[0].retention_amount = '20.00'

  const mapped = mapPackageToCharges(source)
  assertEquals([mapped.retentionAmount, mapped.wrapAmount], [30, 5])

  const payload = invoiceFor(source)
  assertEquals(
    payload.Line.map((row) => [row.Description, row.Amount]),
    [
      ['PHASE MODELS LOTS #2, 4\nDRAW 2', 5656.95],
      ['PRICE ADJUSTMENT PHASE MODELS LOT 2 · DRAW 1', 100],
      ['RETENTION', -30],
      ['WRAP', -5],
    ],
  )
})

Deno.test('a difference of Separate Hardware names its event, and one of a Utility row its name', () => {
  const payload = invoiceFor(drawWithDifferences([
    priceDifference({
      lot_number: '2',
      line_kind: 'HARDWARE_EVENT',
      draw_number: null,
      hardware_event_type: 'EXT',
      gross: '20.00',
    }),
    priceDifference({
      lot_number: 'UTILITY-1',
      is_utility_building: true,
      utility_name: 'B1',
      gross: '30.00',
    }),
  ], '5706.95'))

  assertEquals(
    payload.Line.map((row) => row.Description).slice(1),
    [
      'PRICE ADJUSTMENT PHASE MODELS LOT 2 · HARDWARE EXT',
      'PRICE ADJUSTMENT PHASE MODELS B1 · DRAW 1',
    ],
  )
})

Deno.test('a Builder that bills by building also names the building of each difference', () => {
  const payload = invoiceFor(drawWithDifferences([
    priceDifference({ phase_code: '1', building: 'C5', lot_number: '2', gross: '-75.00' }),
  ], '5581.95', 'BUILDING_SCOPE'))

  assertEquals(
    payload.Line.map((row) => row.Description).slice(0, 1),
    ['PRICE ADJUSTMENT PHASE 1 BUILDING C5 LOT 2 · DRAW 1'],
  )
})

Deno.test('a Utility row difference without a name is refused', () => {
  const error = assertThrows(() =>
    mapPackageToCharges(drawWithDifferences([
      priceDifference({ lot_number: 'UTILITY-1', is_utility_building: true, utility_name: null, gross: '30.00' }),
    ], '5686.95'))
  ) as QuickbooksInvoiceError
  assertEquals(error.code, 'INVALID_INPUT')
})

Deno.test('a Draw Package whose differences leave a negative retention is refused', () => {
  const error = assertThrows(() =>
    mapPackageToCharges(drawWithDifferences([
      priceDifference({ lot_number: '2', gross: '-75.00', retention: '-5.00' }),
    ], '5586.95'))
  ) as QuickbooksInvoiceError
  assertEquals(error.code, 'INVALID_INPUT')
})

Deno.test('a Price Adjustment Package keeps naming the Package each difference comes from', () => {
  const payload = invoiceFor(adjustmentPackage([
    adjustmentLine({ lot_number: '12', gross: '100.00' }),
  ], '100.00'))

  assertEquals(
    payload.Line.map((row) => row.Description),
    ['PHASE 1 LOT #12\nPRICE ADJUSTMENT DP-00000035 · DRAW 2'],
  )
})
