import { assertEquals, assertThrows } from '@std/assert'
import { buildQuickbooksInvoicePayload, QuickbooksInvoiceError } from './quickbooksInvoice.ts'
import {
  mapPackageToCharges,
  type PackageAdjustmentLineRow,
  type PackageDrawRow,
  type PackageHardwareLineRow,
  type PackageInvoiceSource,
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
