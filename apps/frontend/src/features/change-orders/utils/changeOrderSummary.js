// What the summary card of the Extra / CO form shows, worked out from what the form already knows.

import { EVENT_STATUS } from './calendarEvents.js'

/** How each way of covering the Job reads in the summary. */
export const COVERAGE_LABELS = {
  lots: 'Specific lots',
  phase: 'Phases / Buildings',
  job: 'Entire Job',
  plans: 'Specific plan types',
}

/**
 * How many Lots go with each Calendar choice (`evaluations` as `evaluateLots` gives them), in the order EXT,
 * DM, HW, own event. Choices nobody uses are left out. `needOwn` counts the Lots that will need an event of
 * their own whatever was chosen (the event is too close, passed or not on the Calendar).
 */
export function eventBreakdown(evaluations = []) {
  const order = ['EXT', 'DM', 'HW', 'NONE']
  const labels = { EXT: 'EXT', DM: 'DM', HW: 'HW', NONE: 'Own event' }
  const counts = new Map(order.map((key) => [key, 0]))
  let needOwn = 0
  for (const evaluation of evaluations) {
    counts.set(evaluation.event, (counts.get(evaluation.event) ?? 0) + 1)
    if (evaluation.status !== EVENT_STATUS.AVAILABLE && evaluation.status !== EVENT_STATUS.OWN) needOwn += 1
  }
  return {
    parts: order.filter((key) => counts.get(key) > 0).map((key) => ({ key, label: labels[key], count: counts.get(key) })),
    needOwn,
    total: evaluations.length,
  }
}

/**
 * The four steps of the form for the checklist: where each one is on the page (`id`), whether it is complete
 * and, when the person tried to save, which ones need attention.
 */
export function formSteps({ requestDone, whereDone, eventDone, chargedDone, attempted }) {
  const steps = [
    { id: 'co-step-request', label: 'Request', done: requestDone },
    { id: 'co-step-where', label: 'Where the work is', done: whereDone },
    { id: 'co-step-event', label: 'Calendar event', done: eventDone },
    { id: 'co-step-charged', label: 'What is charged', done: chargedDone },
  ]
  return steps.map((step) => ({ ...step, attention: attempted && !step.done }))
}
