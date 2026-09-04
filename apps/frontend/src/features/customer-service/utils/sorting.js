export const sortOptions = [
  { value: 'FOLIO', label: 'Request number' },
  { value: 'NEXT_UP', label: 'Next up' },
  { value: 'NEWEST', label: 'Newest first' },
  { value: 'PRIORITY', label: 'Priority' },
]

// What needs attention next, by group. An overdue visit comes first because it
// is a promise already broken: a confirmed appointment at nine is handled, the
// one that was due four days ago is not. Completed work sinks to the bottom —
// there is nothing left to do with it.
const ATTENTION_GROUP = {
  OVERDUE: 0,
  SCHEDULED: 1,
  NOT_SCHEDULED: 2,
  COMPLETED: 3,
}

const PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 }

function byNextUp(a, b) {
  // A closed request is out of the queue whatever its visit says, so it sinks
  // below everything before the appointment groups are even considered.
  const closed =
    (a.status === 'CLOSED' ? 1 : 0) - (b.status === 'CLOSED' ? 1 : 0)

  if (closed !== 0) return closed

  const group =
    ATTENTION_GROUP[a.appointmentState] - ATTENTION_GROUP[b.appointmentState]

  if (group !== 0) return group

  // Nothing pending, so the most recently finished reads first.
  if (a.appointmentState === 'COMPLETED') {
    return b.appointmentDate.localeCompare(a.appointmentDate)
  }

  // Whoever has been waiting longest for someone to call them.
  if (a.appointmentState === 'NOT_SCHEDULED') {
    return a.reportedAt.localeCompare(b.reportedAt)
  }

  // An ISO date followed by a zero-padded 24-hour time compares correctly as
  // plain text, so the clock needs no parsing.
  return `${a.appointmentDate} ${a.appointmentStart}`.localeCompare(
    `${b.appointmentDate} ${b.appointmentStart}`,
  )
}

// Highest folio first, so the most recently issued request heads the table.
// Numeric collation keeps CS-1057 above CS-999 whatever the digit count.
function byFolio(a, b) {
  return b.requestNumber.localeCompare(a.requestNumber, undefined, {
    numeric: true,
  })
}

function byNewest(a, b) {
  return b.reportedAt.localeCompare(a.reportedAt)
}

function byPriority(a, b) {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byNextUp(a, b)
}

const comparators = {
  FOLIO: byFolio,
  NEXT_UP: byNextUp,
  NEWEST: byNewest,
  PRIORITY: byPriority,
}

export function sortRequests(requests, sortBy) {
  const compare = comparators[sortBy] ?? byFolio

  // Sorting a copy keeps the caller's list untouched, and the folio breaks
  // ties so the order never wobbles between renders.
  return [...requests].sort(
    (a, b) => compare(a, b) || a.requestNumber.localeCompare(b.requestNumber),
  )
}
