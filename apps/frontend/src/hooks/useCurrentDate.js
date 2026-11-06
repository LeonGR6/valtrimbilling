import { useCallback, useEffect, useState } from 'react'

export function isSameLocalDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

/** Milliseconds until the next local midnight (plus a second of margin). */
export function msUntilNextDay(now) {
  const next = new Date(now)
  next.setHours(24, 0, 1, 0)
  return next.getTime() - now.getTime()
}

/**
 * The current date for a screen that stays open for hours. It moves to the new
 * day at midnight and when the tab or window becomes active again, so
 * date-based counts (cutoffs, due dates) are never a day old. `refresh` forces
 * a new reading, for a "Refresh" button.
 */
export function useCurrentDate() {
  const [now, setNow] = useState(() => new Date())

  const sync = useCallback(() => {
    setNow((current) => {
      const reading = new Date()
      return isSameLocalDay(current, reading) ? current : reading
    })
  }, [])

  useEffect(() => {
    let timer
    const schedule = () => {
      timer = setTimeout(() => {
        sync()
        schedule()
      }, msUntilNextDay(new Date()))
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync()
    }

    schedule()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', sync)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', sync)
    }
  }, [sync])

  const refresh = useCallback(() => setNow(new Date()), [])

  return [now, refresh]
}
