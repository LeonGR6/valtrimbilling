import { initialContacts } from '../../builder-contacts/data/builderContacts.js'
import { initialPeople } from '../../people/data/people.js'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const supervisorsById = new Map(initialPeople.map((person) => [person.id, person]))
const superintendentsById = new Map(initialContacts.map((person) => [person.id, person]))

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

export function formatBuilding(value) {
  return String(value).toLowerCase().startsWith('building') ? String(value) : `Building ${value}`
}

function sortLotNumbers(lots) {
  return [...lots].sort((a, b) => Number(a.lotNumber) - Number(b.lotNumber))
}

export function getPhasePatch(job, phase) {
  const lots = sortLotNumbers(phase?.lots ?? [])
  const lotNumbers = lots.map((lot) => String(lot.lotNumber))

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
    foreman: supervisorsById.get(job?.supervisorId)?.name ?? '',
    superintendent: superintendentsById.get(job?.superintendentId)?.name ?? '',
    dmSplitPhase: false,
    dmSplitParts: [],
    hwSplitPhase: false,
    hwSplitParts: [],
  }
}

export function createDefaultSplitParts(draft, date, dateOwner = '', note = '') {
  const lotStart = Math.max(1, Number(draft.lotStart) || 1)
  const requestedEnd = Number(draft.lotEnd) || lotStart + 1
  const lotEnd = Math.max(lotStart + 1, requestedEnd)
  const midpoint = Math.floor((lotStart + lotEnd) / 2)
  const stamp = Date.now()

  return [
    { id: `split-${stamp}-a`, lotStart, lotEnd: midpoint, date, dateOwner, note, history: [] },
    { id: `split-${stamp}-b`, lotStart: midpoint + 1, lotEnd, date, dateOwner, note, history: [] },
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
    { ...part, id: `split-${Date.now()}`, lotStart: midpoint + 1 },
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
