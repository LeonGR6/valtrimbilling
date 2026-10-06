import { resolveJobBillingSchedule } from './packageSuggestions.js'

const QUALIFYING_STATUSES = new Set([
  'READY_TO_SUBMIT',
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

function isDrawPackage(record) {
  return (record.packageType ?? 'DRAW') === 'DRAW'
    && record.status !== 'CANCELLED'
}

function isHardwareLine(line, schedule) {
  if (line.isUtilityBuilding) return false
  return schedule.separateHardwarePrice
    ? Number(line.hardwareAmount) > 0
    : line.eventType === 'HW'
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

    return scopes.flatMap(({ phase, phaseIds }) => {
      const ordinaryLots = (phase ? [phase] : phases)
        .flatMap((candidate) => candidate.lots ?? [])
        .filter((lot) => !lot.isUtilityBuilding)
      const expectedLotIds = new Set(ordinaryLots.map(({ id }) => String(id)))
      if (expectedLotIds.size === 0) return []

      const lines = jobPackages.flatMap((record) => (
        (record.persistedDrawLines ?? [])
          .filter((line) => phaseIds.has(String(line.phaseId)))
          .map((line) => ({ record, line }))
      ))
      const outstanding = lines.filter(({ record, line }) => (
        Number(line.retentionAmount) > 0
        && !activeReleaseLines.has(sourceLineKey(record.id, line.lotId, line.drawId))
      ))
      const projectedRetention = outstanding.reduce(
        (total, { line }) => total + Number(line.retentionAmount),
        0,
      )
      const releasableRetention = outstanding
        .filter(({ record }) => QUALIFYING_STATUSES.has(record.status))
        .reduce((total, { line }) => total + Number(line.retentionAmount), 0)
      const draftRetention = outstanding
        .filter(({ record }) => record.status === 'DRAFT')
        .reduce((total, { line }) => total + Number(line.retentionAmount), 0)

      if (projectedRetention <= 0 && releasableRetention <= 0) return []

      const projectedHardware = new Set()
      const qualifiedHardware = new Set()
      const qualifiedHardwarePackages = new Map()
      for (const { record, line } of lines) {
        if (!expectedLotIds.has(String(line.lotId)) || !isHardwareLine(line, schedule)) {
          continue
        }
        projectedHardware.add(String(line.lotId))
        if (QUALIFYING_STATUSES.has(record.status)) {
          qualifiedHardware.add(String(line.lotId))
          qualifiedHardwarePackages.set(String(record.id), record)
        }
      }

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
        isReady: status === 'READY',
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
