import { assertEquals, assertThrows } from '@std/assert'
import {
  buildQuickbooksInvoicePayload,
  dueDateFor,
  formatLotRanges,
  type PackageCharge,
  QuickbooksInvoiceError,
  type QuickbooksInvoiceInput,
} from './quickbooksInvoice.ts'

const base = {
  customerId: '100000001',
  itemId: '19',
  txnDate: '2026-09-17',
  invoiceLineFormat: 'LOT_SCOPE',
} as const

const draw = (
  lotNumber: string,
  amount: number,
  drawNumber = 3,
  phaseCode = '1',
): PackageCharge => ({ phaseCode, lotNumber, kind: 'DRAW', drawNumber, amount })

const options = (lotNumber: string, amount: number, phaseCode = '1'): PackageCharge => ({
  phaseCode,
  lotNumber,
  kind: 'OPTIONS',
  amount,
})

const line = (description: string, amount: number) => ({
  Amount: amount,
  DetailType: 'SalesItemLineDetail' as const,
  Description: description,
  SalesItemLineDetail: { ItemRef: { value: '19' }, Qty: 1 as const, UnitPrice: amount },
})

Deno.test('reproduces the payload validated in the QuickBooks sandbox', () => {
  const input: QuickbooksInvoiceInput = {
    ...base,
    privateNote: 'ValtrimBilling Postman sandbox test',
    charges: [
      draw('97', 879.27),
      draw('98', 879.27),
      draw('99', 879.26),
      options('98', 50),
    ],
    wrapAmount: 67.21,
    expectedNetAmount: 2620.59,
  }

  assertEquals(buildQuickbooksInvoicePayload(input), {
    CustomerRef: { value: '100000001' },
    TxnDate: '2026-09-17',
    PrivateNote: 'ValtrimBilling Postman sandbox test',
    Line: [
      line('PHASE 1 LOTS #97-99\nDRAW 3', 2637.8),
      line('PHASE 1 LOT #98\nOPTIONS', 50),
      line('WRAP', -67.21),
    ],
  })
})

Deno.test('options row lists only the lots that have options', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    charges: [draw('97', 100), draw('98', 100), draw('99', 100), options('97', 10), options('99', 5)],
    expectedNetAmount: 315,
  })

  assertEquals(payload.Line.map((row) => row.Description), [
    'PHASE 1 LOTS #97-99\nDRAW 3',
    'PHASE 1 LOTS #97, 99\nOPTIONS',
  ])
})

Deno.test('formats lot ranges, gaps and non numeric lots', () => {
  assertEquals(formatLotRanges(['99', '97', '98']), '97-99')
  assertEquals(formatLotRanges(['97', '98', '102']), '97-98, 102')
  assertEquals(formatLotRanges(['12B', '5', '12A', '6', '5']), '5-6, 12A, 12B')
  assertEquals(formatLotRanges(['7']), '7')
})

Deno.test('splits rows by draw and phase, in phase / draw / kind order', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    charges: [
      draw('201', 300, 1, '2'),
      options('101', 20, '1'),
      draw('102', 200, 2, '1'),
      draw('101', 100, 1, '1'),
    ],
    expectedNetAmount: 620,
  })

  assertEquals(
    payload.Line.map((row) => [row.Description, row.Amount]),
    [
      ['PHASE 1 LOT #101\nDRAW 1', 100],
      ['PHASE 1 LOT #102\nDRAW 2', 200],
      ['PHASE 1 LOT #101\nOPTIONS', 20],
      ['PHASE 2 LOT #201\nDRAW 1', 300],
    ],
  )
})

Deno.test('retention and wrap become negative lines and the total matches net', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    charges: [draw('97', 1000)],
    retentionAmount: 100,
    wrapAmount: 25.5,
    expectedNetAmount: 874.5,
  })

  assertEquals(payload.Line.slice(1).map((row) => [row.Description, row.Amount]), [
    ['RETENTION', -100],
    ['WRAP', -25.5],
  ])
  assertEquals(payload.Line[2].SalesItemLineDetail.UnitPrice, -25.5)
})

Deno.test('rejects an invoice whose lines do not add up to the net amount', () => {
  const error = assertThrows(
    () =>
      buildQuickbooksInvoicePayload({
        ...base,
        charges: [draw('97', 1000)],
        wrapAmount: 25,
        expectedNetAmount: 1000,
      }),
    QuickbooksInvoiceError,
  )
  assertEquals(error.code, 'TOTAL_MISMATCH')
})

Deno.test('sums in cents so floating point noise cannot break the total', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    charges: [draw('1', 0.1), draw('2', 0.2)],
    expectedNetAmount: 0.3,
  })

  assertEquals(payload.Line[0].Amount, 0.3)
})

Deno.test('BUILDING_SCOPE groups by building and names its lots', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    invoiceLineFormat: 'BUILDING_SCOPE',
    charges: [
      { ...draw('1', 100), building: 'A' },
      { ...draw('2', 100), building: 'A' },
      { ...draw('3', 50), building: 'B' },
    ],
    expectedNetAmount: 250,
  })

  assertEquals(
    payload.Line.map((row) => [row.Description, row.Amount]),
    [
      ['PHASE 1 BUILDING A LOTS #1-2\nDRAW 3', 200],
      ['PHASE 1 BUILDING B LOT #3\nDRAW 3', 50],
    ],
  )
})

Deno.test('BUILDING_SCOPE groups a Phase without a building by Phase', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    invoiceLineFormat: 'BUILDING_SCOPE',
    charges: [
      draw('1', 100),
      draw('2', 100),
      draw('8', 25, 3, '2'),
      { ...draw('7', 50), phaseCode: '3', building: 'C' },
    ],
    expectedNetAmount: 275,
  })

  assertEquals(
    payload.Line.map((row) => [row.Description, row.Amount]),
    [
      ['PHASE 1 LOTS #1-2\nDRAW 3', 200],
      ['PHASE 2 LOT #8\nDRAW 3', 25],
      ['PHASE 3 BUILDING C LOT #7\nDRAW 3', 50],
    ],
  )
})

Deno.test('hardware and utility each get their own row, also per building', () => {
  const charges: PackageCharge[] = [
    { ...draw('97', 1000), building: 'A' },
    { phaseCode: '1', lotNumber: '97', building: 'A', kind: 'HARDWARE', amount: 200 },
    { phaseCode: '1', lotNumber: 'Utility 1', kind: 'UTILITY', amount: 300 },
    {
      phaseCode: '1',
      lotNumber: 'Utility 1',
      kind: 'UTILITY',
      scopeLabel: 'Utility - Rough',
      amount: 50,
    },
  ]

  for (const invoiceLineFormat of ['LOT_SCOPE', 'BUILDING_SCOPE'] as const) {
    const payload = buildQuickbooksInvoicePayload({
      ...base,
      invoiceLineFormat,
      charges,
      expectedNetAmount: 1550,
    })
    const place = invoiceLineFormat === 'LOT_SCOPE' ? 'LOT #97' : 'BUILDING A LOT #97'

    assertEquals(
      payload.Line.map((row) => [row.Description, row.Amount]),
      [
        [`PHASE 1 ${place}\nDRAW 3`, 1000],
        [`PHASE 1 ${place}\nHARDWARE`, 200],
        ['PHASE 1 UTILITY 1\nUTILITY', 300],
        ['PHASE 1 UTILITY 1\nUTILITY - ROUGH', 50],
      ],
    )
  }
})

Deno.test('skips zero amounts and fails when nothing is left to invoice', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    charges: [draw('97', 100), options('97', 0)],
    expectedNetAmount: 100,
  })
  assertEquals(payload.Line.length, 1)

  const error = assertThrows(
    () =>
      buildQuickbooksInvoicePayload({
        ...base,
        charges: [options('97', 0)],
        expectedNetAmount: 0,
      }),
    QuickbooksInvoiceError,
  )
  assertEquals(error.code, 'NO_LINES')
})

Deno.test('adds optional header fields and tax code only when provided', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    dueDate: '2026-10-17',
    docNumber: 'DP-00000042',
    taxCodeId: 'NON',
    charges: [draw('97', 100)],
    expectedNetAmount: 100,
  })

  assertEquals(payload.DueDate, '2026-10-17')
  assertEquals(payload.DocNumber, 'DP-00000042')
  assertEquals(payload.Line[0].SalesItemLineDetail.TaxCodeRef, { value: 'NON' })
})

Deno.test('rejects invalid header values', () => {
  const invalid = (patch: Partial<QuickbooksInvoiceInput>) =>
    assertThrows(
      () =>
        buildQuickbooksInvoicePayload({
          ...base,
          charges: [draw('97', 100)],
          expectedNetAmount: 100,
          ...patch,
        }),
      QuickbooksInvoiceError,
    ).code

  assertEquals(invalid({ customerId: ' ' }), 'INVALID_INPUT')
  assertEquals(invalid({ txnDate: '09/17/2026' }), 'INVALID_INPUT')
  assertEquals(invalid({ docNumber: 'X'.repeat(22) }), 'INVALID_INPUT')
  assertEquals(invalid({ retentionAmount: -5 }), 'INVALID_INPUT')
})

Deno.test('adds payment terms days to the invoice date without timezone drift', () => {
  assertEquals(dueDateFor('2026-10-09', 30), '2026-11-08')
  assertEquals(dueDateFor('2026-12-20', 15), '2027-01-04')
  assertEquals(dueDateFor('2026-10-09', 0), '2026-10-09')
  assertEquals(dueDateFor('2026-10-09', null), undefined)
  assertThrows(() => dueDateFor('2026-10-09', -1), QuickbooksInvoiceError)
  assertThrows(() => dueDateFor('10/09/2026', 30), QuickbooksInvoiceError)
})

Deno.test('an Options credit is a negative invoice line that still adds up to the net amount', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    charges: [
      draw('98', 1000),
      options('98', -120.5),
    ],
    retentionAmount: 88.15,
    expectedNetAmount: 791.35,
  })

  assertEquals(payload.Line, [
    line('PHASE 1 LOT #98\nDRAW 3', 1000),
    line('PHASE 1 LOT #98\nOPTIONS', -120.5),
    line('RETENTION', -88.15),
  ])
})

Deno.test('Options and credits of the same scope are added into one line', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    charges: [
      draw('97', 500),
      options('97', 300),
      draw('98', 500),
      options('98', -120.5),
    ],
    expectedNetAmount: 1179.5,
  })

  assertEquals(payload.Line.map((item) => item.Amount), [1000, 179.5])
})

Deno.test('a Price Adjustment charge reads "PRICE ADJUSTMENT" and goes after the other kinds', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    charges: [
      { phaseCode: '1', lotNumber: '12', kind: 'PRICE_ADJUSTMENT', amount: 30 },
      draw('12', 100),
    ],
    expectedNetAmount: 130,
  })

  assertEquals(payload.Line.map((row) => row.Description), [
    'PHASE 1 LOT #12\nDRAW 3',
    'PHASE 1 LOT #12\nPRICE ADJUSTMENT',
  ])
})

Deno.test('a negative charge is allowed and a group that cancels out is dropped', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    charges: [
      { phaseCode: '1', lotNumber: '12', kind: 'PRICE_ADJUSTMENT', scopeLabel: 'PRICE ADJUSTMENT DP-1 · DRAW 2', amount: 100 },
      { phaseCode: '1', lotNumber: '13', kind: 'PRICE_ADJUSTMENT', scopeLabel: 'PRICE ADJUSTMENT DP-1 · DRAW 2', amount: -100 },
      { phaseCode: '1', lotNumber: '14', kind: 'PRICE_ADJUSTMENT', scopeLabel: 'PRICE ADJUSTMENT DP-1 · DRAW 3', amount: -40 },
      { phaseCode: '1', lotNumber: '15', kind: 'PRICE_ADJUSTMENT', scopeLabel: 'PRICE ADJUSTMENT DP-1 · DRAW 4', amount: 90 },
    ],
    expectedNetAmount: 50,
  })

  assertEquals(payload.Line.map((row) => [row.Description, row.Amount]), [
    ['PHASE 1 LOT #14\nPRICE ADJUSTMENT DP-1 · DRAW 3', -40],
    ['PHASE 1 LOT #15\nPRICE ADJUSTMENT DP-1 · DRAW 4', 90],
  ])
})

Deno.test('a price change reads "PRICE ADJUSTMENT PHASE ... LOT ... · DRAW ..." on a row of its own', () => {
  const payload = buildQuickbooksInvoicePayload({
    ...base,
    charges: [
      { phaseCode: 'MODELS', lotNumber: '2', kind: 'PRICE_CHANGE', scopeLabel: 'DRAW 1', amount: -75 },
      { phaseCode: 'MODELS', lotNumber: '4', kind: 'PRICE_CHANGE', scopeLabel: 'DRAW 1', amount: -79.75 },
      { phaseCode: 'MODELS', lotNumber: '2', kind: 'DRAW', drawNumber: 2, amount: 2683.85 },
    ],
    expectedNetAmount: 2529.1,
  })

  assertEquals(payload.Line.map((row) => [row.Description, row.Amount]), [
    ['PHASE MODELS LOT #2\nDRAW 2', 2683.85],
    ['PRICE ADJUSTMENT PHASE MODELS LOT 2 · DRAW 1', -75],
    ['PRICE ADJUSTMENT PHASE MODELS LOT 4 · DRAW 1', -79.75],
  ])
})
