import { assertEquals, assertThrows } from '@std/assert'
import { buildQuickbooksInvoicePayload, QuickbooksInvoiceError } from './quickbooksInvoice.ts'
import {
  mapPackageToCharges,
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
