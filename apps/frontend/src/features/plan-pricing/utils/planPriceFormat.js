const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

export function hasPrice(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function formatPrice(value) {
  return hasPrice(value) ? currencyFormatter.format(value) : 'Not priced'
}

// An Option priced NA adds and subtracts nothing, and reads "NA", not "$0.00".
export function formatOptionPrice(option) {
  return option.priceNotApplicable ? 'NA' : formatPrice(option.price)
}
