import { calculateBusinessDueDate } from '../schemas/persistedCustomerServiceSchema.js'

function zonedParts(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant).map(({ type, value }) => [type, value]),
  )

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  }
}

function roundUpQuarterHour(time) {
  const [hours, minutes] = time.split(':').map(Number)
  const totalMinutes = Math.ceil((hours * 60 + minutes) / 15) * 15
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}

export function suggestServiceWorkdays(
  createdAt,
  settings,
  now = new Date(),
  savedDueOn = null,
) {
  const timeZone = settings.timeZone ?? 'America/Los_Angeles'
  const workdayStart = (settings.workdayStartsAt ?? '08:00').slice(0, 5)
  const workdayEnd = (settings.workdayEndsAt ?? '17:00').slice(0, 5)
  const created = zonedParts(new Date(createdAt), timeZone)
  const createdOn = created.date
  const deadlineStart = new Date(`${createdOn}T12:00:00Z`)
  if (created.time >= workdayEnd) {
    deadlineStart.setUTCDate(deadlineStart.getUTCDate() + 1)
  }
  const startOn = calculateBusinessDueDate(
    deadlineStart.toISOString().slice(0, 10),
    1,
  )
  const dueOn = savedDueOn ?? calculateBusinessDueDate(
    startOn,
    settings.businessDaysToComplete ?? 5,
  )
  const current = zonedParts(now, timeZone)
  const days = []

  for (
    const cursor = new Date(`${createdOn}T12:00:00Z`);
    cursor.toISOString().slice(0, 10) <= dueOn;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) continue

    const date = cursor.toISOString().slice(0, 10)
    if (date < current.date) continue

    const start = date === current.date
      ? [workdayStart, roundUpQuarterHour(current.time)].sort().at(-1)
      : workdayStart
    if (start >= workdayEnd) continue

    days.push({
      date,
      availableFrom: `${date}T${start}`,
      availableUntil: `${date}T${workdayEnd}`,
    })
  }

  return { createdOn, startOn, dueOn, days }
}
