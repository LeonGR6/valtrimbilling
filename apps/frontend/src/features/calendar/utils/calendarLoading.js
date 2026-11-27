// What the Calendar shows while its events are on their way. The grid and its dates are real from
// the first moment, so the events are the only thing missing: stand-ins take their place, in the
// cells where events will be.

/** A load shorter than `showAfter` shows nothing; one longer than `slowAfter` says it is slow. */
export const LOADING_THRESHOLDS = {
  showAfter: 200,
  slowAfter: 10000,
  // How long the events take to settle in once they arrive.
  reveal: 400,
}

/**
 * 'pending' (still short enough to show nothing), 'loading' or 'slow', for a load that has lasted
 * `elapsed` ms. A Calendar that is not loading at all is 'idle'; that is the hook's to say.
 */
export function loadingPhaseAt(elapsed, thresholds = LOADING_THRESHOLDS) {
  if (elapsed >= thresholds.slowAfter) return 'slow'
  if (elapsed >= thresholds.showAfter) return 'loading'
  return 'pending'
}

const DAY_MS = 24 * 60 * 60 * 1000
// Beyond two months (the Year view) the cells are too small for stand-ins.
const MAX_GHOST_RANGE_DAYS = 62
// How many stand-ins a weekday gets: it looks like a busy week without being the same every day.
const WEEKDAY_COUNTS = [1, 2, 1, 3, 2, 1, 2]
const WIDTHS = [100, 82, 64]

const dateKey = (milliseconds) => new Date(milliseconds).toISOString().slice(0, 10)

/**
 * The stand-in events for the days from `start` up to `end` (the range the Calendar is showing).
 * They depend on the date only, so a day looks the same wherever it is shown. They carry
 * `extendedProps.ghost` and a `width` (percent), and cannot be moved.
 */
export function ghostEventsBetween(start, end) {
  const first = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const last = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  if (!(last > first) || (last - first) / DAY_MS > MAX_GHOST_RANGE_DAYS) return []

  const events = []
  for (let day = first; day < last; day += DAY_MS) {
    const dayNumber = Math.round(day / DAY_MS)
    const weekday = new Date(day).getUTCDay()
    const weekend = weekday === 0 || weekday === 6
    const count = weekend
      ? (dayNumber % 4 === 0 ? 1 : 0)
      : WEEKDAY_COUNTS[(dayNumber * 3) % WEEKDAY_COUNTS.length]

    for (let index = 0; index < count; index += 1) {
      events.push({
        id: `ghost-${dateKey(day)}-${index}`,
        start: dateKey(day),
        allDay: true,
        startEditable: false,
        durationEditable: false,
        extendedProps: { ghost: true, width: WIDTHS[(dayNumber + index) % WIDTHS.length] },
      })
    }
  }
  return events
}

/** An event source for the Calendar: stand-ins for whatever range it asks for. */
export function ghostEventSource({ start, end }, success) {
  success(ghostEventsBetween(start, end))
}
