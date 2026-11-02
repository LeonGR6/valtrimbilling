import { useEffect, useState } from 'react'
import { LOADING_THRESHOLDS, loadingPhaseAt } from '../utils/calendarLoading.js'

/**
 * How a load that is `active` should look: 'idle' when there is none, 'pending' while it is still
 * short, then 'loading', then 'slow'. `revealing` is true for a moment after a load that was shown
 * ends, so what arrived can settle in instead of popping.
 */
export function useLoadingPhase(active, thresholds = LOADING_THRESHOLDS) {
  const { showAfter, slowAfter, reveal } = thresholds
  const [phase, setPhase] = useState('pending')
  const [revealing, setRevealing] = useState(false)

  // The effects depend on the numbers, not on the object, so a caller that builds its thresholds
  // on every render does not restart the timers.
  useEffect(() => {
    if (!active) return undefined

    const bounds = { showAfter, slowAfter }
    let shown = false
    const showTimer = setTimeout(() => {
      shown = true
      setPhase(loadingPhaseAt(showAfter, bounds))
    }, showAfter)
    const slowTimer = setTimeout(() => {
      setPhase(loadingPhaseAt(slowAfter, bounds))
    }, slowAfter)

    return () => {
      clearTimeout(showTimer)
      clearTimeout(slowTimer)
      setPhase('pending')
      if (shown) setRevealing(true)
    }
  }, [active, showAfter, slowAfter])

  useEffect(() => {
    if (!revealing) return undefined

    const timer = setTimeout(() => setRevealing(false), reveal)
    return () => clearTimeout(timer)
  }, [revealing, reveal])

  return { phase: active ? phase : 'idle', revealing }
}
