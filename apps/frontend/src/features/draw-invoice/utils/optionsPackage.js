import { calculateInvoiceAmounts } from './drawWorksheet.js'

const toCents = (amount) => Math.round(Number(amount || 0) * 100)

/**
 * What an Options Package invoices for these Options. The retention and the WRAP are taken Option by
 * Option and rounded to the cent each, as the database does, so the preview adds up to the invoice.
 *
 * @param options  { price }, an Option with no price counts as nothing (the Package is not created
 *                 until every Option has one)
 * @param schedule the Job's billing setup (retention and WRAP percentages)
 */
export function optionsPackageAmounts(options = [], schedule) {
  let gross = 0
  let retention = 0
  let wrap = 0

  for (const option of options) {
    const amounts = calculateInvoiceAmounts(Number(option.price), schedule)
    gross += toCents(amounts.currentDraw)
    retention += toCents(amounts.retention)
    wrap += toCents(amounts.wrapInsurance)
  }

  return {
    gross: gross / 100,
    retention: retention / 100,
    wrap: wrap / 100,
    net: (gross - retention - wrap) / 100,
  }
}
