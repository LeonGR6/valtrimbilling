// Moving an event on the Calendar by dragging it. The drag itself never saves:
// it opens the event's configuration with the new date filled in, and the
// change only happens when the person confirms there.

import { getProductionDateCascade } from './calendarDateRules.js'

const DATE_FIELDS = [
  ['extDate', 'EXT'],
  ['shutterDate', 'Shutter'],
  ['dmDate', 'DM'],
  ['hwDate', 'HW'],
  ['extInstallDate', 'EXT install only'],
  ['dmInstallDate', 'DM install only'],
  ['dmBaseboardInstallDate', 'DM baseboard install'],
  ['hwLockUpDate', 'HW lock up'],
]

const SPLIT_FIELDS = [
  ['extSplitParts', 'EXT'],
  ['dmSplitParts', 'DM'],
  ['hwSplitParts', 'HW'],
]

/**
 * The draft with the dragged event on its new date. The date rules apply as in
 * the form: moving EXT or DM carries the dates that follow it.
 *
 * @param props the dragged event's `extendedProps`
 * @param newDate ISO date the event was dropped on
 */
export function moveEventInDraft({ draft, props, newDate, configuration }) {
  const type = props.activityType
  const key = String(type).toLowerCase()

  if (props.variant === 'install-only') {
    return { ...draft, [`${key}InstallDate`]: newDate }
  }

  if (props.variant === 'baseboard-install') {
    return { ...draft, dmBaseboardInstallDate: newDate }
  }

  if (props.variant === 'lock-up') {
    return { ...draft, hwLockUpDate: newDate }
  }

  if (props.variant === 'division') {
    const field = `${key}SplitParts`
    const parts = draft[field] ?? []
    // The part the event belongs to: by its saved schedule, else by its lots.
    const index = parts.findIndex((part) => (
      props.scheduleId != null && String(part.scheduleId) === String(props.scheduleId)
    ))
    const target = index >= 0
      ? index
      : parts.findIndex((part) => (
        Number(part.lotStart) === Number(props.lotStart)
        && Number(part.lotEnd) === Number(props.lotEnd)
      ))
    if (target < 0) return draft

    return {
      ...draft,
      [field]: parts.map((part, position) => (
        position === target ? { ...part, date: newDate } : part
      )),
    }
  }

  return { ...draft, ...getProductionDateCascade(draft, type, newDate, configuration) }
}

/** The dates that differ between two drafts: [{ label, from, to }]. */
export function describeDateChanges(before, after) {
  const changes = []

  for (const [field, label] of DATE_FIELDS) {
    if ((before[field] ?? '') !== (after[field] ?? '')) {
      changes.push({ label, from: before[field] ?? '', to: after[field] ?? '' })
    }
  }

  for (const [field, label] of SPLIT_FIELDS) {
    const previous = before[field] ?? []
    ;(after[field] ?? []).forEach((part, index) => {
      if ((previous[index]?.date ?? '') !== (part.date ?? '')) {
        changes.push({
          label: `${label} division ${index + 1}`,
          from: previous[index]?.date ?? '',
          to: part.date ?? '',
        })
      }
    })
  }

  return changes
}
