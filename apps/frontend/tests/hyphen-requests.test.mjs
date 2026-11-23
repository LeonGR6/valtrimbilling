import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatChangeType,
  formatHyphenDate,
  listSpconnectLines,
  listSpconnectOptions,
  matchesSpconnectSearch,
  summarizeSpconnectMessage,
} from '../src/features/hyphen/utils/spconnectMessage.js'

// Trimmed from the first UAT order Hyphen sent (20 Nov 2026), without the
// homeowner's contact data.
const orderRow = {
  id: 1,
  received_at: '2026-11-20T18:11:45.508Z',
  environment: 'UAT',
  kind: 'Order',
  order_id: 22327597,
  builder_order_number: '48949975-162',
  purpose: 'Original',
  change_order_number: null,
  change_order_sequence: null,
  payload: {
    items: [
      {
        total: 6325.2,
        itemOptions: null,
        itemDescription: 'Finish Carpentry - Lot: 0043 Pln: AD8  Ele: 0W',
        builderLineItemNum: '115910482',
        builderSupplierSKU: 'CONTRACT',
        builderTotalQuantity: { quantityOrdered: 1, unitOfMeasurement: 'EA' },
      },
      {
        total: 136,
        itemOptions: [
          {
            optionName: 'INDH0001',
            locations: [
              {
                location: 'PERPLAN',
                quantity: '0',
                preferences: [
                  { name: 'FIN', value: 'INDH-Black' },
                  { name: 'STY', value: 'INDH-Ladera Lever Round Rosette' },
                ],
              },
            ],
          },
        ],
        itemDescription: 'Finish Carpentry - Lot: 0043 Pln: AD8  Ele: 0W - PERPLAN',
        builderLineItemNum: '116140120',
        builderSupplierSKU: 'CONTRACT',
        builderTotalQuantity: { quantityOrdered: 1, unitOfMeasurement: 'EA' },
      },
    ],
    header: {
      id: 22327597,
      job: {
        lot: '0043',
        city: 'Irvine',
        plan: 'AD8 Tula X',
        block: null,
        phase: 'Phase 001',
        swing: 'R',
        street: '200 Charlie',
        endDate: '4/12/2027',
        elevation: '0W',
        startDate: '2/25/2026',
        subdivision: 'Birch at Great Park',
        communityCode: null,
      },
      task: { name: 'Finish Carpentry [1128153 _ 48949975-162 _ 5640-31][ON]', taskNum: '580' },
      builder: {
        id: 'FBB85F77-C421-41F1-9BF0-0D45F5E76FE8',
        address: { name: 'Toll Brothers Inc. E1 - So Cal' },
      },
      endDate: '2026-12-01T00:00:00',
      options: [
        {
          id: '27',
          name: 'INDH0001',
          type: 'Customizing',
          values: [
            { name: 'INDH0001', description: 'Interior Door Hardware-Gr' },
            { name: 'Description 1', description: 'Interior Door Hardware-Gr' },
            { name: 'Description 2', description: 'Finish Change Only' },
          ],
        },
      ],
      purpose: 'Original',
      supplier: { address: { name: 'Valtrim Inc' } },
      issueDate: '2026-11-20T12:10:39',
      orderType: 'PurchaseOrder',
      startDate: '2026-11-25T00:00:00',
      deliveryType: 'Null',
      accountNumber: 'CAS-1128153',
      builderOrderNumber: '48949975-162',
    },
    summary: { taxAmount: 0, orderTotal: 7122.2, numberOfLines: 6, orderSubTotal: 7122.2 },
  },
}

test('Hyphen dates read as calendar dates, whatever their format', () => {
  assert.equal(formatHyphenDate('2026-11-25T00:00:00'), 'Nov 25, 2026')
  assert.equal(formatHyphenDate('2/25/2026'), 'Feb 25, 2026')
  assert.equal(formatHyphenDate('Null'), null)
  assert.equal(formatHyphenDate(null), null)
})

test('an order summary shows the PO, the house and the work dates', () => {
  const summary = summarizeSpconnectMessage(orderRow)

  assert.equal(summary.id, '1')
  assert.equal(summary.kind, 'ORDER')
  assert.equal(summary.orderId, 22327597)
  assert.equal(summary.poNumber, '48949975-162')
  assert.equal(summary.builderName, 'Toll Brothers Inc. E1 - So Cal')
  assert.equal(summary.community, 'Birch at Great Park')
  assert.equal(summary.lot, '0043')
  assert.equal(summary.block, null)
  assert.equal(summary.plan, 'AD8 Tula X')
  assert.equal(summary.workStart, 'Nov 25, 2026')
  assert.equal(summary.workEnd, 'Dec 1, 2026')
  assert.equal(summary.orderTotal, 7122.2)
  assert.equal(summary.lineCount, 6)
  assert.equal(summary.changeOrderNumber, null)
})

test('a change order is recognized from the stored kind', () => {
  const summary = summarizeSpconnectMessage({
    ...orderRow,
    kind: 'ChangeOrder',
    change_order_number: 3,
    change_order_sequence: 2,
  })

  assert.equal(summary.kind, 'CHANGE_ORDER')
  assert.equal(summary.changeOrderNumber, '3')
  assert.equal(summary.changeOrderSequence, 2)
})

// Shaped like the Reschedule Hyphen sent for the same order (23 Nov 2026):
// issueDate becomes orderIssueDate and every line is wrapped.
const rescheduleRow = {
  ...orderRow,
  id: 3,
  kind: 'CHANGE_ORDER',
  change_order_number: '92DA127B-2834-4317-B822-EF312833717D',
  change_order_sequence: 2,
  payload: {
    ...orderRow.payload,
    header: {
      ...orderRow.payload.header,
      issueDate: undefined,
      orderIssueDate: '2026-11-20T12:10:39',
      changeType: 'Reschedule',
      changeOrderNumber: '92DA127B-2834-4317-B822-EF312833717D',
      changeOrderSequence: '2',
      changeOrderIssueDate: '2026-11-23T10:32:12',
      changeOrderHeaderNote: 'test reschedule',
      startDate: '2026-12-02T00:00:00',
      endDate: '2026-12-04T00:00:00',
    },
    items: orderRow.payload.items.map((item) => ({
      changeCode: 'ReplaceAllValues',
      originalLineNum: item.builderLineItemNum,
      originalItemDetailWithChanges: item,
    })),
  },
}

test('a change order shows its type, number, note and new dates', () => {
  const summary = summarizeSpconnectMessage(rescheduleRow)

  assert.equal(summary.kind, 'CHANGE_ORDER')
  assert.equal(summary.changeType, 'Reschedule')
  assert.equal(summary.changeOrderSequence, 2)
  assert.equal(summary.changeIssuedAt, 'Nov 23, 2026')
  assert.equal(summary.changeNote, 'test reschedule')
  assert.equal(summary.issuedAt, 'Nov 20, 2026')
  assert.equal(summary.workStart, 'Dec 2, 2026')
  assert.equal(summary.workEnd, 'Dec 4, 2026')
})

test('change order lines are read from inside their wrapper', () => {
  const [baseLine, optionLine] = listSpconnectLines(rescheduleRow.payload)

  assert.equal(baseLine.lineNumber, '115910482')
  assert.equal(baseLine.changeCode, 'ReplaceAllValues')
  assert.equal(baseLine.description, 'Finish Carpentry - Lot: 0043 Pln: AD8  Ele: 0W')
  assert.equal(baseLine.total, 6325.2)
  assert.equal(optionLine.options[0].name, 'INDH0001')
})

test('change types read the way Austin named them', () => {
  assert.equal(formatChangeType('NotesOnly'), 'Notes only')
  assert.equal(formatChangeType('Notes Only'), 'Notes only')
  assert.equal(formatChangeType('ChangeInDetail (Items)'), 'Items')
  assert.equal(formatChangeType('ChangeInHeadingSection'), 'Options')
  assert.equal(formatChangeType(null), null)
})

test('lines carry their options, locations and preferences', () => {
  const [baseLine, optionLine] = listSpconnectLines(orderRow.payload)

  assert.equal(baseLine.lineNumber, '115910482')
  assert.equal(baseLine.total, 6325.2)
  assert.deepEqual(baseLine.options, [])

  assert.equal(optionLine.options[0].name, 'INDH0001')
  assert.equal(optionLine.options[0].description, 'Interior Door Hardware-Gr · Finish Change Only')
  assert.deepEqual(optionLine.options[0].locations, [
    { location: 'PERPLAN', preferences: ['FIN: INDH-Black', 'STY: INDH-Ladera Lever Round Rosette'] },
  ])
})

test('header options list each option once with its descriptions', () => {
  assert.deepEqual(listSpconnectOptions(orderRow.payload), [
    { name: 'INDH0001', description: 'Interior Door Hardware-Gr · Finish Change Only' },
  ])
})

test('search finds a request by PO, order ID, community or lot', () => {
  const summary = summarizeSpconnectMessage(orderRow)

  assert.equal(matchesSpconnectSearch(summary, '48949975'), true)
  assert.equal(matchesSpconnectSearch(summary, '22327597'), true)
  assert.equal(matchesSpconnectSearch(summary, 'birch'), true)
  assert.equal(matchesSpconnectSearch(summary, '0043'), true)
  assert.equal(matchesSpconnectSearch(summary, '  '), true)
  assert.equal(matchesSpconnectSearch(summary, 'pulte'), false)
})
