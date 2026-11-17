// The Extras / COs Draw & Invoice works with, in its "Change Orders" tab: every approved or cancelled one,
// with the Package that invoices it. One made from a Package charges the Lots of a "Specific Plan Types"
// Extra / CO that a Package billed after it was approved.

/** Which tab an Extra / CO is in: TO_INVOICE (approved, no invoice yet), INVOICED or CANCELLED. */
export function invoiceStateOf(order) {
  if (order.status === 'CANCELLED') return 'CANCELLED'
  return order.invoicePackageId ? 'INVOICED' : 'TO_INVOICE'
}

export const BILLABLE_TABS = [
  { value: 'TO_INVOICE', label: 'To invoice' },
  { value: 'INVOICED', label: 'Invoiced' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'ALL', label: 'All' },
]

/** The ones in the tab ('ALL' or a state) matching every word typed, in the order they came. */
export function filterBillableOrders(orders, { tab = 'ALL', search = '' } = {}) {
  const words = String(search).toLowerCase().split(/\s+/).filter(Boolean)

  return orders.filter((order) => {
    if (tab !== 'ALL' && invoiceStateOf(order) !== tab) return false
    if (words.length === 0) return true
    const haystack = [
      order.number, order.poCoNumber, order.sourceNumber, order.sourcePackageNumber, order.invoicePackageNumber,
      order.builderName, order.jobCode, order.community, order.fromPackage ? 'from package' : '',
    ].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** The tabs with how many Extras / COs are in each. */
export function billableTabs(orders) {
  return BILLABLE_TABS.map((tab) => ({
    ...tab,
    count: tab.value === 'ALL' ? orders.length : orders.filter((order) => invoiceStateOf(order) === tab.value).length,
  }))
}

/** What is still to invoice: how many, and their total, in cents (credits are not invoiced). */
export function summarizeToInvoice(orders) {
  const pending = orders.filter((order) => invoiceStateOf(order) === 'TO_INVOICE' && order.totalAmount > 0)
  const cents = pending.reduce((sum, order) => sum + Math.round(order.totalAmount * 100), 0)
  return { count: pending.length, total: cents / 100 }
}

/**
 * Why an Extra / CO cannot be invoiced from here, or '' when it can. Only the roles that invoice Packages
 * see the button (`canInvoice`); the database checks the same.
 */
export function invoiceProblem(order) {
  if (order.status !== 'APPROVED') return 'Only an approved Extra / CO is invoiced.'
  if (order.invoicePackageId) return `Already invoiced on ${order.invoicePackageNumber}.`
  if (order.totalAmount <= 0) return 'Its total is a credit or zero: QuickBooks takes it as a Credit Memo, not an invoice.'
  return ''
}
