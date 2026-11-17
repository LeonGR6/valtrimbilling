import assert from 'node:assert/strict'
import test from 'node:test'
import {
  billableTabs,
  filterBillableOrders,
  invoiceProblem,
  invoiceStateOf,
  summarizeToInvoice,
} from '../src/features/change-orders/utils/packageOrders.js'

const order = (overrides = {}) => ({
  id: 40,
  number: 'CO-0007',
  poCoNumber: '',
  status: 'APPROVED',
  fromPackage: false,
  sourceNumber: '',
  sourcePackageNumber: '',
  invoicePackageId: null,
  invoicePackageNumber: '',
  builderName: 'KB Home',
  jobCode: '1295',
  community: 'Rancho Madrina',
  lineCount: 2,
  totalAmount: 0.1,
  ...overrides,
})

const orders = [
  order(),
  order({ id: 41, number: 'CO-0008', fromPackage: true, sourceNumber: 'CO-0002', sourcePackageNumber: 'DP-00000090', poCoNumber: 'PO 1277447', totalAmount: 0.2 }),
  order({ id: 42, number: 'CO-0009', invoicePackageId: 300, invoicePackageNumber: 'CP-00000300', totalAmount: 500 }),
  order({ id: 43, number: 'CO-0010', status: 'CANCELLED', builderName: 'Lennar', totalAmount: 7 }),
  order({ id: 44, number: 'CO-0011', totalAmount: -20 }),
]

test('an Extra / CO is to invoice, invoiced or cancelled', () => {
  assert.deepEqual(orders.map(invoiceStateOf), ['TO_INVOICE', 'TO_INVOICE', 'INVOICED', 'CANCELLED', 'TO_INVOICE'])
})

test('the tabs count each state, and To invoice comes first', () => {
  assert.deepEqual(billableTabs(orders).map(({ value, count }) => [value, count]), [
    ['TO_INVOICE', 3],
    ['INVOICED', 1],
    ['CANCELLED', 1],
    ['ALL', 5],
  ])
})

test('the search reaches the CO, its PO / CO #, where it came from, its invoice Package, the Builder and the Job', () => {
  const found = (search, tab) => filterBillableOrders(orders, { search, tab }).map((item) => item.number)

  assert.deepEqual(found('', 'TO_INVOICE'), ['CO-0007', 'CO-0008', 'CO-0011'])
  assert.deepEqual(found('dp-00000090'), ['CO-0008'])
  assert.deepEqual(found('from package'), ['CO-0008'])
  assert.deepEqual(found('1277447'), ['CO-0008'])
  assert.deepEqual(found('cp-00000300'), ['CO-0009'])
  assert.deepEqual(found('rancho lennar'), ['CO-0010'])
})

test('what is still to invoice leaves out credits, invoiced and cancelled ones, exactly', () => {
  assert.deepEqual(summarizeToInvoice(orders), { count: 2, total: 0.3 })
  assert.deepEqual(summarizeToInvoice([]), { count: 0, total: 0 })
})

test('only an approved Extra / CO with a total above zero and no invoice yet can be invoiced', () => {
  assert.equal(invoiceProblem(orders[0]), '')
  assert.match(invoiceProblem(orders[2]), /Already invoiced on CP-00000300/)
  assert.match(invoiceProblem(orders[3]), /approved/)
  assert.match(invoiceProblem(orders[4]), /Credit Memo/)
  assert.match(invoiceProblem(order({ totalAmount: 0 })), /credit or zero/)
})
