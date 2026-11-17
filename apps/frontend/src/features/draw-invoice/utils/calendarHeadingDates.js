import { formatLongDate } from './drawInvoiceFormatters.js'
import { formatLotRanges } from './lotRanges.js'

// A second event of the same stage, on its own date, that is not a division of the lots.
const EXTRA_EVENT_LABELS = {
  INSTALL_ONLY: 'install only',
  LOCK_UP: 'lock-up',
}

/**
 * The lines that say which lots go with each date of a Draw's event, when the Calendar gave it more
 * than one date. Empty for an event with a single date: its heading already says it.
 */
export function headingDivisions(heading) {
  const divisions = heading?.divisions ?? []
  if (divisions.length < 2) return []

  return divisions.map(({ date, lotNumbers, variants = [] }) => ({
    key: date,
    date: formatLongDate(date),
    lots: formatLotRanges(lotNumbers),
    extra: variants.length > 0 && variants.every((variant) => EXTRA_EVENT_LABELS[variant])
      ? EXTRA_EVENT_LABELS[variants[0]]
      : '',
  }))
}
