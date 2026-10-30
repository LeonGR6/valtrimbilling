import { resolveJobBillingSchedule } from './packageSuggestions.js'

const QUALIFYING_STATUSES = new Set([
  'AWAITING_PAYMENT',
  'PAID_CLOSED',
])

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null

  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ))
  return date.toISOString().slice(0, 10) === value ? date : null
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10)
}

function dateOnMonthDay(year, month, day) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)))
}

export function addOneMonthClamped(value) {
  const date = parseDateKey(value)
  if (!date) return null

  return toDateKey(dateOnMonthDay(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  ))
}

export function resolveRetentionCutoffDate(packageDate, schedule) {
  const date = parseDateKey(packageDate)
  if (!date || !schedule || schedule.anyDate) return null

  if (schedule.frequency === 'MONTHLY') {
    const cutoffDay = Number(schedule.cutoffDay)
    if (!Number.isInteger(cutoffDay)) return null
    for (let offset = 0; offset <= 1; offset += 1) {
      const candidate = dateOnMonthDay(
        date.getUTCFullYear(),
        date.getUTCMonth() + offset,
        cutoffDay,
      )
      if (candidate >= date) return toDateKey(candidate)
    }
  }

  if (schedule.frequency === 'SEMIMONTHLY') {
    const cutoffDays = [...new Set((schedule.cutoffDays ?? [])
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31))]
      .sort((left, right) => left - right)
    for (let offset = 0; offset <= 1; offset += 1) {
      for (const cutoffDay of cutoffDays) {
        const candidate = dateOnMonthDay(
          date.getUTCFullYear(),
          date.getUTCMonth() + offset,
          cutoffDay,
        )
        if (candidate >= date) return toDateKey(candidate)
      }
    }
  }

  if (schedule.frequency === 'WEEKLY') {
    const cutoffWeekday = Number(schedule.cutoffWeekday)
    if (!Number.isInteger(cutoffWeekday)) return null
    const candidate = new Date(date)
    candidate.setUTCDate(
      candidate.getUTCDate()
      + ((cutoffWeekday - candidate.getUTCDay() + 7) % 7),
    )
    return toDateKey(candidate)
  }

  return null
}

function sourceLineKey(packageId, lotId, drawId) {
  return `${packageId}:${lotId}:${drawId}`
}

function sourceHardwareLineKey(hardwareLineId) {
  return String(hardwareLineId)
}

function sourceOptionLineKey(packageId, lotId, optionId) {
  return `${packageId}:${lotId}:${optionId}`
}

function isDrawPackage(record) {
  return (record.packageType ?? 'DRAW') === 'DRAW'
    && record.status !== 'CANCELLED'
}

function hardwareCompletionPart(line, schedule) {
  if (line.isUtilityBuilding) return false
  if (!schedule.separateHardwarePrice) {
    return line.eventType === 'HW' ? 'FULL' : null
  }
  if (
    (Number(line.hardwarePercentage) || 0) <= 0
    && (Number(line.hardwareAmount) || 0) <= 0
  ) return null
  return schedule.hardwareBillingMode === 'BY_EVENT'
    ? line.hardwareEventType ?? line.eventType ?? null
    : 'FULL'
}

function requiredHardwareParts(schedule) {
  if (
    schedule.separateHardwarePrice
    && schedule.hardwareBillingMode === 'BY_EVENT'
  ) {
    return ['EXT', 'DM', 'HW'].filter(
      (eventType) => Number(schedule.hardwareEventPercentages?.[eventType]) > 0,
    )
  }
  return ['FULL']
}

function compareSuggestions(left, right) {
  const priority = {
    READY: 0,
    WAITING_FOR_DATE: 1,
    PROJECTED: 2,
    WAITING_FOR_HARDWARE: 3,
    CUTOFF_REQUIRED: 4,
  }
  return (priority[left.status] ?? 9) - (priority[right.status] ?? 9)
    || String(left.availableDate ?? '9999-12-31')
      .localeCompare(String(right.availableDate ?? '9999-12-31'))
    || String(left.job.code ?? '').localeCompare(String(right.job.code ?? ''), 'en', {
      numeric: true,
      sensitivity: 'base',
    })
}

export function buildRetentionSuggestions({
  jobs = [],
  schedules = [],
  jobBillingSetupVersions = [],
  packages = [],
  asOfDate,
}) {
  if (!parseDateKey(asOfDate)) return []

  const activeReleaseLines = new Set()
  const activeReleaseHardwareLines = new Set()
  const activeReleaseAdjustmentLines = new Set()
  const activeReleaseOptionLines = new Set()
  for (const record of packages) {
    if (record.packageType !== 'RETENTION_RELEASE' || record.status === 'CANCELLED') {
      continue
    }
    for (const line of record.retentionRelease?.sourceLines ?? []) {
      activeReleaseLines.add(sourceLineKey(
        line.sourcePackageId,
        line.sourceLotId,
        line.sourceDrawId,
      ))
    }
    for (const line of record.retentionRelease?.sourceHardwareLines ?? []) {
      activeReleaseHardwareLines.add(sourceHardwareLineKey(
        line.sourceHardwareLineId,
      ))
    }
    for (const line of record.retentionRelease?.sourceAdjustmentLines ?? []) {
      activeReleaseAdjustmentLines.add(String(line.sourceAdjustmentLineId))
    }
    for (const line of record.retentionRelease?.sourceOptionLines ?? []) {
      activeReleaseOptionLines.add(sourceOptionLineKey(
        line.sourcePackageId,
        line.sourceLotId,
        line.sourceOptionId,
      ))
    }
  }

  return jobs.flatMap((job) => {
    const schedule = resolveJobBillingSchedule(
      job,
      schedules,
      jobBillingSetupVersions,
    )
    if (!schedule?.retentionEnabled) return []

    const scopeType = schedule.retentionReleaseScope === 'BUILDING'
      ? 'BUILDING'
      : 'JOB'
    const phases = job.sequenceSheet?.phases ?? []
    const scopes = scopeType === 'BUILDING'
      ? phases.map((phase) => ({ phase, phaseIds: new Set([String(phase.id)]) }))
      : [{ phase: null, phaseIds: new Set(phases.map(({ id }) => String(id))) }]
    const jobPackages = packages.filter((record) => (
      String(record.jobId) === String(job.id) && isDrawPackage(record)
    ))
    // Price Adjustments retain money too. Their lines are signed: a credit gives back
    // less, which is what the Retention Release does with them.
    const jobAdjustments = packages.filter((record) => (
      String(record.jobId) === String(job.id)
      && record.packageType === 'PRICE_ADJUSTMENT'
      && record.status !== 'CANCELLED'
    ))

    // Options billed on a Package of their own retain on their own lines, signed like an adjustment's.
    const jobOptionsPackages = packages.filter((record) => (
      String(record.jobId) === String(job.id)
      && record.packageType === 'OPTIONS'
      && record.status !== 'CANCELLED'
    ))

    return scopes.flatMap(({ phase, phaseIds }) => {
      const ordinaryLots = (phase ? [phase] : phases)
        .flatMap((candidate) => candidate.lots ?? [])
        .filter((lot) => !lot.isUtilityBuilding)
      const expectedLotIds = new Set(ordinaryLots.map(({ id }) => String(id)))
      if (expectedLotIds.size === 0) return []

      const lines = jobPackages.flatMap((record) => ([
        ...(record.persistedDrawLines ?? [])
          .filter((line) => phaseIds.has(String(line.phaseId)))
          .map((line) => ({ record, line, sourceType: 'DRAW' })),
        ...(record.persistedHardwareLines ?? [])
          .filter((line) => phaseIds.has(String(line.phaseId)))
          .map((line) => ({ record, line, sourceType: 'HARDWARE' })),
      ]))
      const outstanding = lines.filter(({ record, line, sourceType }) => {
        if (Number(line.retentionAmount) <= 0) return false
        if (sourceType === 'HARDWARE') {
          return !activeReleaseHardwareLines.has(sourceHardwareLineKey(line.id))
        }
        return !activeReleaseLines.has(
          sourceLineKey(record.id, line.lotId, line.drawId),
        )
      })
      const outstandingAdjustments = jobAdjustments.flatMap((record) => (
        (record.priceAdjustment?.lines ?? [])
          .filter((line) => (
            phaseIds.has(String(line.phaseId))
            && Number(line.retention) !== 0
            && !activeReleaseAdjustmentLines.has(String(line.id))
          ))
          .map((line) => ({ record, amount: Number(line.retention) }))
      ))
      const outstandingOptions = jobOptionsPackages.flatMap((record) => (
        (record.persistedOptionLines ?? [])
          .filter((line) => (
            phaseIds.has(String(line.phaseId))
            && Number(line.retentionAmount) !== 0
            && !activeReleaseOptionLines.has(
              sourceOptionLineKey(record.id, line.lotId, line.optionId),
            )
          ))
          .map((line) => ({ record, amount: Number(line.retentionAmount) }))
      ))
      const outstandingAmounts = [
        ...outstanding.map(({ record, line }) => ({
          record,
          amount: Number(line.retentionAmount),
        })),
        ...outstandingAdjustments,
        ...outstandingOptions,
      ]
      const roundCents = (value) => Math.round(value * 100) / 100
      const projectedRetention = roundCents(outstandingAmounts.reduce(
        (total, { amount }) => total + amount,
        0,
      ))
      const releasableRetention = roundCents(outstandingAmounts
        .filter(({ record }) => QUALIFYING_STATUSES.has(record.status))
        .reduce((total, { amount }) => total + amount, 0))
      const draftRetention = roundCents(outstandingAmounts
        .filter(({ record }) => record.status === 'DRAFT')
        .reduce((total, { amount }) => total + amount, 0))

      // A Draft only counts once something of the Job is Awaiting payment or Paid: a Job
      // whose Packages are all Drafts has no suggestion yet.
      if (releasableRetention <= 0) return []

      const requiredParts = requiredHardwareParts(schedule)
      const projectedPartsByLot = new Map()
      const qualifiedPartsByLot = new Map()
      const qualifiedHardwarePackages = new Map()
      for (const { record, line } of lines) {
        const lotId = String(line.lotId)
        const part = hardwareCompletionPart(line, schedule)
        if (!expectedLotIds.has(lotId) || !part) {
          continue
        }
        const projectedParts = projectedPartsByLot.get(lotId) ?? new Set()
        projectedParts.add(part)
        projectedPartsByLot.set(lotId, projectedParts)
        if (QUALIFYING_STATUSES.has(record.status)) {
          const qualifiedParts = qualifiedPartsByLot.get(lotId) ?? new Set()
          qualifiedParts.add(part)
          qualifiedPartsByLot.set(lotId, qualifiedParts)
          qualifiedHardwarePackages.set(String(record.id), record)
        }
      }
      const projectedHardware = new Set([...expectedLotIds].filter((lotId) => (
        requiredParts.every((part) => projectedPartsByLot.get(lotId)?.has(part))
      )))
      const qualifiedHardware = new Set([...expectedLotIds].filter((lotId) => (
        requiredParts.every((part) => qualifiedPartsByLot.get(lotId)?.has(part))
      )))

      const remainingHardwareLots = Math.max(
        0,
        expectedLotIds.size - qualifiedHardware.size,
      )
      const projectedRemainingHardwareLots = Math.max(
        0,
        expectedLotIds.size - projectedHardware.size,
      )
      const cutoffDates = [...qualifiedHardwarePackages.values()].map(
        (record) => record.billingCutoffDate
          ?? resolveRetentionCutoffDate(record.packageDate, schedule),
      )
      const hasMissingCutoff = cutoffDates.some((value) => !value)
      const sourceCutoffDate = hasMissingCutoff || cutoffDates.length === 0
        ? null
        : [...cutoffDates].sort().at(-1)
      // The release is held one month after the cutoff of the last Hardware Package, the same date
      // the database refuses to create it before.
      const availableDate = addOneMonthClamped(sourceCutoffDate)

      let status = 'WAITING_FOR_HARDWARE'
      if (remainingHardwareLots > 0 && projectedRemainingHardwareLots === 0) {
        status = 'PROJECTED'
      } else if (remainingHardwareLots === 0 && !sourceCutoffDate) {
        status = 'CUTOFF_REQUIRED'
      } else if (remainingHardwareLots === 0 && availableDate > asOfDate) {
        status = 'WAITING_FOR_DATE'
      } else if (remainingHardwareLots === 0 && releasableRetention > 0) {
        status = 'READY'
      } else if (remainingHardwareLots === 0 && draftRetention > 0) {
        status = 'PROJECTED'
      }

      return [{
        job,
        schedule,
        scopeType,
        phase,
        phaseId: phase?.id ?? null,
        status,
        // Only READY can be created. WAITING_FOR_DATE has everything but the date, so it can be
        // reviewed ahead of time.
        isReady: status === 'READY',
        canReview: status === 'READY' || status === 'WAITING_FOR_DATE',
        projectedRetention,
        releasableRetention,
        draftRetention,
        expectedLotCount: expectedLotIds.size,
        completedHardwareLots: qualifiedHardware.size,
        remainingHardwareLots,
        projectedRemainingHardwareLots,
        sourceCutoffDate,
        availableDate,
      }]
    })
  }).sort(compareSuggestions)
}
