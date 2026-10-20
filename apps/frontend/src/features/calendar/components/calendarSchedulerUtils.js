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

// The two starting divisions split the lots in half. Their date and note are
// left empty on purpose: the person has to enter them, so a date is never
// copied over by mistake.
export function createDefaultSplitParts(draft, dateOwner = '') {
  const lotStart = Math.max(1, Number(draft.lotStart) || 1)
  const requestedEnd = Number(draft.lotEnd) || lotStart + 1
  const lotEnd = Math.max(lotStart + 1, requestedEnd)
  const midpoint = Math.floor((lotStart + lotEnd) / 2)
  const stamp = Date.now()

  return [
    { id: `split-${stamp}-a`, lotStart, lotEnd: midpoint, date: '', dateOwner, note: '', history: [] },
    { id: `split-${stamp}-b`, lotStart: midpoint + 1, lotEnd, date: '', dateOwner, note: '', history: [] },
  ]
}

export function addSplitDivision(parts) {
  let widestIndex = -1
  let widestSize = 0

  parts.forEach((part, index) => {
    const size = Number(part.lotEnd) - Number(part.lotStart) + 1
    if (size > widestSize) {
      widestIndex = index
      widestSize = size
    }
  })

  if (widestIndex < 0 || widestSize < 2) return parts

  const part = parts[widestIndex]
  const midpoint = Math.floor((Number(part.lotStart) + Number(part.lotEnd)) / 2)
  const nextParts = [...parts]
  nextParts.splice(
    widestIndex,
    1,
    { ...part, lotEnd: midpoint },
    // The new division starts blank: its date and note are entered by hand.
    {
      id: `split-${Date.now()}`,
      lotStart: midpoint + 1,
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
