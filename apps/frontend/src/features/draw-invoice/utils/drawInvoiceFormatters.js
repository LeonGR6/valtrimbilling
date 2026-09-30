const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

export function formatCurrency(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? currencyFormatter.format(value)
    : '—'
}

export function formatPercentage(value) {
  const percentage = Number(value) || 0
  return Number.isInteger(percentage)
    ? String(percentage)
    : percentage.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function formatDate(value) {
  if (!value) return '—'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatLongDate(value) {
  if (!value) return '—'
  const dateKey = String(value).slice(0, 10)
  const date = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatBillingPeriod(record) {
  if (record.billingCutoffAnyDate) return 'Any date'
  if (!record.billingCutoffDate) return 'Not set'
  return formatLongDate(record.billingCutoffDate)
}

export function readinessLabel(worksheet) {
  if (!worksheet.hasSchedule) return 'Schedule missing'
  if (!worksheet.scheduleIsValid) return 'Schedule needs review'
  if (worksheet.rows.length === 0) return 'No lots'
  if (worksheet.missingPlanCount > 0) return 'Plan missing'
  if (worksheet.unpricedLotCount > 0) return 'Pricing incomplete'
  if (worksheet.missingHardwarePriceCount > 0)
    return 'Hardware pricing incomplete'
  if (worksheet.invalidHardwarePriceCount > 0)
    return 'Hardware pricing invalid'
  return 'Ready'
}
