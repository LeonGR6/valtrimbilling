// How much of a Job's price sheet is filled in: a price for every Plan and for
// every Option. An Option priced NA (stored as $0.00) or with a credit counts
// as priced; only one that was never priced is still missing.

function isPriced(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function getJobPricingStatus(job) {
  const plans = job?.sequenceSheet?.plans ?? []
  const options = plans.flatMap((plan) => plan.options ?? [])
  const total = plans.length + options.length
  const priced = plans.filter((plan) => isPriced(plan.price)).length
    + options.filter((option) => isPriced(option.price)).length
  const missing = total - priced

  return {
    planCount: plans.length,
    optionCount: options.length,
    total,
    priced,
    missing,
    // A Job without Plans has nothing to price, so it is not "complete" either.
    complete: total > 0 && missing === 0,
    percent: total === 0 ? 0 : Math.round((priced / total) * 100),
  }
}
