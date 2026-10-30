import { lotsInRange, sortedLotNumbers } from '../utils/splitLotGroups.js'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatDate(dateString) {
  return dateString ? dateFormatter.format(parseLocalDate(dateString)) : '—'
}

export function formatPhase(value) {
  return String(value).toLowerCase().startsWith('phase') ? String(value) : `Phase ${value}`
}

// A Phase can have no Building: it reads as an empty text, not "Building null".
export function formatBuilding(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.toLowerCase().startsWith('building') ? text : `Building ${text}`
}

/** "Phase 2 · Building A", or just "Phase 2" when the Phase has no Building. */
export function formatPhaseBuilding(phase, building, separator = ' · ') {
  return [formatPhase(phase), formatBuilding(building)].filter(Boolean).join(separator)
}

export function findJobBuilder(job, builders = []) {
  return builders.find((builder) => (
    builder.id === job?.builderId || builder.name === job?.builder
  ))
}

function sortLotNumbers(lots) {
  return [...lots].sort((a, b) => Number(a.lotNumber) - Number(b.lotNumber))
}

export function getPhasePatch(job, phase, people = [], builderContacts = []) {
  const lots = sortLotNumbers(
    (phase?.lots ?? []).filter((lot) => !lot.isUtilityBuilding),
  )
  const lotNumbers = lots.map((lot) => String(lot.lotNumber))
  const supervisor = people.find((person) => person.id === job?.supervisorId)
  const superintendent = builderContacts.find(
    (contact) => contact.id === job?.superintendentId,
  )

  return {
    jobId: job?.id ?? '',
    phaseId: phase?.id ?? '',
    jobCode: job?.code ?? '',
    builder: job?.builder ?? '',
    community: job?.community ?? '',
    phase: phase ? formatPhase(phase.name) : '',
    building: phase ? formatBuilding(phase.building) : '',
    lotStart: Number(lotNumbers[0]) || 1,
    lotEnd: Number(lotNumbers.at(-1)) || 1,
    lotNumbers,
    lotIds: lots.map((lot) => Number(lot.id)),
    foreman: supervisor?.name ?? '',
    superintendent: superintendent?.name ?? '',
    dmSplitPhase: false,
    dmSplitParts: [],
    hwSplitPhase: false,
    hwSplitParts: [],
  }
}

// The Lots a split starts from. A Phase can hold separate groups (11–14 and
// 21–23), so the real Lot numbers are used and the gaps between them are not
// counted. Without them, it falls back to the continuous From–To range.
function splitLots(draft) {
  const lots = sortedLotNumbers(draft.lotNumbers)
  if (lots.length >= 2) return lots

  const lotStart = Math.max(1, Number(draft.lotStart) || 1)
  const lotEnd = Math.max(lotStart + 1, Number(draft.lotEnd) || lotStart + 1)
  return Array.from({ length: lotEnd - lotStart + 1 }, (_, index) => lotStart + index)
}

// The two starting divisions split the lots in half. Their date and note are
// left empty on purpose: the person has to enter them, so a date is never
// copied over by mistake.
export function createDefaultSplitParts(draft, dateOwner = '') {
  const lots = splitLots(draft)
  const half = Math.ceil(lots.length / 2)
  const stamp = Date.now()

  return [
    { id: `split-${stamp}-a`, lotStart: lots[0], lotEnd: lots[half - 1], date: '', dateOwner, note: '', history: [] },
    { id: `split-${stamp}-b`, lotStart: lots[half], lotEnd: lots.at(-1), date: '', dateOwner, note: '', history: [] },
  ]
}

// Splits the division with the most Lots in two. `lotNumbers` are the Lots of
// the Phase, so a division that spans a gap (11–14 and 21–23) is split by the
// Lots it really has.
export function addSplitDivision(parts, lotNumbers = []) {
  const phaseLots = sortedLotNumbers(lotNumbers)
  const lotsOf = (part) => (phaseLots.length
    ? lotsInRange(phaseLots, part.lotStart, part.lotEnd)
    : Array.from(
      { length: Math.max(0, Number(part.lotEnd) - Number(part.lotStart) + 1) },
      (_, index) => Number(part.lotStart) + index,
    ))

  let widestIndex = -1
  let widestLots = []

  parts.forEach((part, index) => {
    const lots = lotsOf(part)
    if (lots.length > widestLots.length) {
      widestIndex = index
      widestLots = lots
    }
  })

  if (widestIndex < 0 || widestLots.length < 2) return parts

  const part = parts[widestIndex]
  const half = Math.ceil(widestLots.length / 2)
  const nextParts = [...parts]
  nextParts.splice(
    widestIndex,
    1,
    { ...part, lotEnd: widestLots[half - 1] },
    // The new division starts blank: its date and note are entered by hand.
    {
      id: `split-${Date.now()}`,
      lotStart: widestLots[half],
      lotEnd: part.lotEnd,
      date: '',
      dateOwner: part.dateOwner,
      note: '',
      history: [],
    },
  )
  return nextParts
}

export function removeSplitDivision(parts, index) {
  if (parts.length <= 2) return parts

  const nextParts = parts.map((part) => ({ ...part }))
  const [removed] = nextParts.splice(index, 1)
  if (index > 0) nextParts[index - 1].lotEnd = removed.lotEnd
  else nextParts[0].lotStart = removed.lotStart
  return nextParts
}
