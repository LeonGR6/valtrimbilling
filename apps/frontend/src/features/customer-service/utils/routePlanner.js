import {
  toZonedDateTimeInput,
  zonedDateTimeToIso,
} from '../services/customerServiceRecord.js'

export function groupServiceScheduleProposals(proposals) {
  const dates = new Map()

  for (const proposal of proposals) {
    const technicians = dates.get(proposal.proposedOn) ?? new Map()
    const technicianKey = String(proposal.technicianId)
    const group = technicians.get(technicianKey) ?? {
      technicianId: proposal.technicianId,
      technicianName: proposal.technicianName,
      proposals: [],
    }
    group.proposals.push(proposal)
    technicians.set(technicianKey, group)
    dates.set(proposal.proposedOn, technicians)
  }

  return [...dates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, technicians]) => ({
      date,
      technicians: [...technicians.values()]
        .sort((left, right) => (
          left.technicianName.localeCompare(right.technicianName)
        ))
        .map((group) => ({
          ...group,
          proposals: group.proposals.sort((left, right) => (
            left.rank - right.rank || left.id - right.id
          )),
        })),
    }))
}

export function adjustedStopEndInput(stop, startInput, timeZone) {
  if (!startInput) return ''

  const startsAt = zonedDateTimeToIso(startInput, timeZone)
  const duration = new Date(stop.endsAt).getTime()
    - new Date(stop.startsAt).getTime()
  return toZonedDateTimeInput(
    new Date(new Date(startsAt).getTime() + duration).toISOString(),
    timeZone,
  )
}

export function buildProposalAdjustments(proposal, startsByRequest, timeZone) {
  return proposal.stops.flatMap((stop) => {
    const startInput = startsByRequest[stop.requestId]
    if (!startInput) return []

    const startsAt = zonedDateTimeToIso(startInput, timeZone)
    if (new Date(startsAt).getTime() === new Date(stop.startsAt).getTime()) {
      return []
    }

    const duration = new Date(stop.endsAt).getTime()
      - new Date(stop.startsAt).getTime()
    return [{
      requestId: stop.requestId,
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + duration).toISOString(),
    }]
  })
}
