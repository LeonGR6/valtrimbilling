// How many of a Plan's Options have a price. An Option priced NA (stored as $0.00)
// or with a credit counts as priced: only one that was never priced does not.

function isPriced(option) {
  return typeof option.price === 'number' && Number.isFinite(option.price)
}

/** "3 of 12 options priced": what a closed Plan still says about its options. */
export function optionPricingSummary(options = []) {
  const priced = options.filter(isPriced).length
  const missing = options.length - priced
  return {
    priced,
    missing,
    total: options.length,
    complete: missing === 0,
    label: options.length === 0
      ? 'No options'
      : `${priced} of ${options.length} ${options.length === 1 ? 'option' : 'options'} priced`,
  }
}
