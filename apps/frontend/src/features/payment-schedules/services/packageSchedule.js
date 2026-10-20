import { cleanNamePart, PACKAGE_DOCUMENT_BUCKET } from '../../release-templates/services/packageRelease.js'
import { formatMoney, normalizeCodeKey } from './paymentScheduleRecord.js'

// Generating a Payment Schedule for a Package: which cell of the Job's schedules
// each Lot and draw of the Package is, and the names of the files and paths
// involved. Pure; the network lives in the repository and the PDF in its own
// module.

export { PACKAGE_DOCUMENT_BUCKET }

function toCents(value) {
  return Math.round(Number(value) * 100)
}

/**
 * The Lot / draw lines of a Package, as the schedule is compared with. A Package
 * line is the amount of one draw of one Lot; hardware and options billed apart
 * are not part of the schedule.
 */
export function packageScheduleLines(record) {
  return (record?.persistedDrawLines ?? []).map((line) => {
    const base = Number(line.baseDrawAmount) || 0
    const hardware = Number(line.hardwareAmount) || 0
    return {
      phase: line.phaseCode ?? '',
      lot: String(line.lotNumber ?? ''),
      draw: Number(line.drawIndex) + 1,
      label: line.utilityLabel ?? `Lot ${line.lotNumber}`,
      isUtilityBuilding: Boolean(line.isUtilityBuilding),
      packageAmount: base,
      // The schedule prints the price of the draw. Where the hardware is billed
      // inside the draw, it is part of that price.
      acceptedCents: [...new Set([toCents(base), toCents(base + hardware)])],
    }
  })
}

function byNewestConfirmation(left, right) {
  return Date.parse(right.confirmedAt ?? 0) - Date.parse(left.confirmedAt ?? 0)
}

/**
 * Finds the schedule cell of every line of the Package.
 *  - A cell matches by Phase, Lot and draw, comparing the normalized codes. A
 *    cell without a Phase matches the Lot and draw in any Phase.
 *  - When two schedules hold the same cell, the most recently confirmed wins.
 *
 * Returns `matches` (line, cell, template and whether the amounts agree),
 * `unmatched` lines, and `sources`: each schedule that has a match with the
 * cells to highlight, in order.
 */
export function matchPackageToSchedules(lines, templates) {
  const indexed = [...templates].sort(byNewestConfirmation).map((template) => {
    const exact = new Map()
    const anyPhase = new Map()
    for (const cell of template.mapping?.cells ?? []) {
      const lotDraw = `${normalizeCodeKey(cell.lot)}|${cell.draw}`
      if (cell.phase === null || cell.phase === '') {
        if (!anyPhase.has(lotDraw)) anyPhase.set(lotDraw, cell)
      } else {
        const key = `${normalizeCodeKey(cell.phase)}|${lotDraw}`
        if (!exact.has(key)) exact.set(key, cell)
      }
    }
    return { template, exact, anyPhase }
  })

  const matches = []
  const unmatched = []
  for (const line of lines) {
    const lotDraw = `${normalizeCodeKey(line.lot)}|${line.draw}`
    const phaseKey = `${normalizeCodeKey(line.phase)}|${lotDraw}`
    let found = null
    for (const entry of indexed) {
      const cell = entry.exact.get(phaseKey) ?? entry.anyPhase.get(lotDraw)
      if (cell) {
        found = { template: entry.template, cell }
        break
      }
    }

    if (!found) {
      unmatched.push(line)
    } else {
      matches.push({
        line,
        cell: found.cell,
        template: found.template,
        amountsAgree: line.acceptedCents.includes(toCents(found.cell.amount)),
      })
    }
  }

  const sources = indexed
    .map(({ template }) => ({
      template,
      cells: matches.filter((match) => match.template === template).map((match) => match.cell),
    }))
    .filter((source) => source.cells.length > 0)

  return {
    matches,
    unmatched,
    sources,
    differing: matches.filter((match) => !match.amountsAgree),
  }
}

// --- Previously Invoiced and This Request -----------------------------------
//
// A matrix schedule leaves two rows blank for each invoice. "This Request" is
// what this Package bills in each draw; "Previously Invoiced" is what the earlier
// Packages of the Job billed in the same draw, for the Lots of that schedule. The
// totals are per schedule, so a Package that touches two schedules fills each
// with its own.

const plainAmount = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function isEarlier(candidate, record) {
  const left = Date.parse(candidate.createdAt ?? 0)
  const right = Date.parse(record.createdAt ?? 0)
  return left !== right ? left < right : Number(candidate.id) < Number(record.id)
}

/**
 * The earlier Packages of the Job that can count as already invoiced: draw
 * Packages that are not cancelled and were made before this one, oldest first.
 */
export function listEarlierPackages(record, packages) {
  return (packages ?? [])
    .filter((candidate) => (
      candidate.id !== record.id
      && candidate.jobId === record.jobId
      && (candidate.packageType ?? 'DRAW') === 'DRAW'
      && candidate.status !== 'CANCELLED'
      && isEarlier(candidate, record)
    ))
    .sort((left, right) => (
      Date.parse(left.createdAt ?? 0) - Date.parse(right.createdAt ?? 0)
      || Number(left.id) - Number(right.id)
    ))
}

/** What a matched line asks for: the schedule's amount when they agree, else the Package's. */
export function requestedAmount(match) {
  return match.amountsAgree ? match.cell.amount : match.line.packageAmount
}

function sumByDraw(matches) {
  const totals = new Map()
  for (const match of matches) {
    const draw = match.cell.draw
    totals.set(draw, (totals.get(draw) ?? 0) + toCents(requestedAmount(match)))
  }
  return totals
}

/**
 * The values of the two rows for each schedule the Package uses.
 * `earlier` holds each earlier Package that counts, with its own plan against the
 * same schedules. Returns, per source: the table of draws (previously, request,
 * contract), the `fills` to write on the PDF, the lines already billed before
 * (`repeated`) and the draws that would bill more than the contract (`over`).
 */
export function summarizeSources(plan, earlier) {
  return plan.sources
    .filter((source) => source.template.mapping?.summaryRows)
    .map((source) => {
      const { template } = source
      const rows = template.mapping.summaryRows
      const inTemplate = (match) => match.template === template
      const request = sumByDraw(plan.matches.filter(inTemplate))

      const previouslyMatches = earlier.flatMap(({ number, plan: earlierPlan }) => (
        earlierPlan.matches.filter(inTemplate).map((match) => ({ ...match, number }))
      ))
      const previously = sumByDraw(previouslyMatches)

      const contract = new Map()
      for (const cell of template.mapping.cells) {
        contract.set(cell.draw, (contract.get(cell.draw) ?? 0) + toCents(cell.amount))
      }

      const draws = [...new Set([...request.keys(), ...previously.keys()])]
        .sort((left, right) => left - right)
        .map((draw) => {
          const before = previously.get(draw) ?? 0
          const now = request.get(draw) ?? 0
          const total = contract.get(draw) ?? 0
          return {
            draw,
            previously: before / 100,
            request: now / 100,
            contract: total / 100,
            // Billing more of a draw than the schedule holds.
            over: before + now > total,
          }
        })

      const fills = []
      for (const [key, values] of [
        ['previouslyInvoiced', previously],
        ['thisRequest', request],
      ]) {
        for (const target of rows[key] ?? []) {
          const cents = values.get(target.draw) ?? 0
          // A draw nothing was billed in stays blank instead of printing 0.00.
          if (cents <= 0) continue
          fills.push({
            row: key,
            draw: target.draw,
            page: target.page,
            rect: target.rect,
            text: plainAmount.format(cents / 100),
          })
        }
      }

      const billedBefore = new Map(previouslyMatches.map((match) => [match.cell, match.number]))
      const repeated = plan.matches
        .filter(inTemplate)
        .filter((match) => billedBefore.has(match.cell))
        .map((match) => ({ line: match.line, number: billedBefore.get(match.cell) }))

      // Every box of both rows, filled or not: what is typed in any of them is old.
      const fillBoxes = [...(rows.previouslyInvoiced ?? []), ...(rows.thisRequest ?? [])]
        .map(({ page, rect }) => ({ page, rect }))

      return {
        template,
        draws,
        fills,
        fillBoxes,
        repeated,
        over: draws.filter((row) => row.over),
      }
    })
}

export function describeRepeated(item) {
  return `${item.line.label} · draw ${item.line.draw}, already in ${item.number}`
}

export function describeOver(row) {
  return `Draw ${row.draw}: ${formatMoney(row.previously)} before + ${formatMoney(row.request)} now is more than the ${formatMoney(row.contract)} of the schedule`
}

/** What the dialog says about a plan: how much will be highlighted and what needs a look. */
export function describeSchedulePlan(plan, lineCount) {
  const warnings = plan.differing.length + plan.unmatched.length
  return {
    highlighted: plan.matches.length,
    lineCount,
    sourceCount: plan.sources.length,
    warnings,
    // Nothing to highlight: the Package is not in any of the schedules.
    canGenerate: plan.matches.length > 0,
  }
}

export function describeDifference(match) {
  return `${match.line.label} · draw ${match.line.draw}: Package ${formatMoney(match.line.packageAmount)}, schedule ${formatMoney(match.cell.amount)}`
}

export function describeUnmatchedLine(line) {
  return `${line.phase ? `${line.phase} · ` : ''}${line.label} · draw ${line.draw}`
}

export function buildPackageScheduleStoragePath(packageId, uniqueId) {
  return `${Number(packageId)}/payment_schedule/${uniqueId}.pdf`
}

/** Name of the generated file, e.g. "Payment Schedule - Job 1318 - DP-00000046.pdf". */
export function buildPackageScheduleFileName({ jobCode, packageNumber }) {
  const parts = [
    'Payment Schedule',
    jobCode ? `Job ${cleanNamePart(jobCode)}` : '',
    cleanNamePart(packageNumber),
  ].filter(Boolean)

  // 255 is the database limit for a file name, including ".pdf".
  return `${parts.join(' - ').slice(0, 250)}.pdf`
}
