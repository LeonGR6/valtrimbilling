// The edit mode of the price sheet: every price becomes a field, the person
// changes what is needed and saves once. These helpers read what was typed (with
// the same rules as the single-price dialog), work out which prices really
// changed, and merge what the server reports for several changed prices into one
// list of Phases.
import {
  createHardwarePriceSchema,
  optionPriceSchema,
  priceSchema,
} from '../schemas/priceSchema.js'

export const cellKey = {
  plan: (planId) => `plan:${planId}`,
  hardware: (planId) => `hardware:${planId}`,
  option: (optionId) => `option:${optionId}`,
}

export function isPriced(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** What a field shows before anything is typed: the current price, or nothing. */
export function editableText(kind, item) {
  if (kind === 'option') {
    if (item.priceNotApplicable) return 'NA'
    return isPriced(item.price) ? item.price.toFixed(2) : ''
  }
  const price = kind === 'hardware' ? item.hardwarePrice : item.price
  return isPriced(price) ? price.toFixed(2) : ''
}

/**
 * Reads one typed price. `{ empty: true }` for a blank field, `{ ok: true, value }`
 * for a valid one (`value` is `{ amount, notApplicable? }`), `{ ok: false, error }`
 * otherwise.
 */
export function parseCell(kind, text, { planPrice = null } = {}) {
  if (String(text ?? '').trim() === '') return { empty: true }

  const schema = kind === 'option'
    ? optionPriceSchema
    : kind === 'hardware' ? createHardwarePriceSchema(planPrice) : priceSchema
  const result = schema.safeParse({ amount: String(text) })

  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'Enter a valid price.' }
  }
  return { ok: true, value: result.data }
}

/**
 * Compares what was typed with what the sheet holds.
 *
 * `drafts` maps a field (see `cellKey`) to its text; only fields the person
 * touched are in it. Returns the prices that changed (a Plan with its Hardware is
 * one change, as it is saved in one go), the invalid fields with their message,
 * and the keys of the changed fields so the sheet can mark them.
 */
export function evaluateWorksheet(plans, drafts, { separateHardwarePrice = false } = {}) {
  const errors = new Map()
  const changes = []
  const changedKeys = new Set()

  for (const plan of plans) {
    const planKey = cellKey.plan(plan.id)
    const hardwareKey = cellKey.hardware(plan.id)
    let base = plan.price
    let hardware = plan.hardwarePrice ?? null
    let baseChanged = false
    let hardwareChanged = false

    if (drafts.has(planKey)) {
      const read = parseCell('plan', drafts.get(planKey))
      if (read.empty) {
        // A price can be replaced but not taken away.
        if (isPriced(plan.price)) errors.set(planKey, 'Enter a price.')
      } else if (!read.ok) {
        errors.set(planKey, read.error)
      } else if (read.value.amount !== plan.price) {
        base = read.value.amount
        baseChanged = true
        changedKeys.add(planKey)
      }
    }

    if (separateHardwarePrice && drafts.has(hardwareKey)) {
      const read = parseCell('hardware', drafts.get(hardwareKey), { planPrice: base })
      if (read.empty) {
        if (isPriced(plan.hardwarePrice)) errors.set(hardwareKey, 'Enter a price.')
      } else if (!read.ok) {
        errors.set(hardwareKey, read.error)
      } else if (read.value.amount !== plan.hardwarePrice) {
        hardware = read.value.amount
        hardwareChanged = true
        changedKeys.add(hardwareKey)
      }
    }

    if (baseChanged || hardwareChanged) {
      changes.push({
        type: 'plan',
        plan,
        from: { base: plan.price, hardware: plan.hardwarePrice ?? null },
        to: { base, hardware },
        baseChanged,
        hardwareChanged,
      })
    }

    for (const option of plan.options ?? []) {
      const optionKey = cellKey.option(option.id)
      if (!drafts.has(optionKey)) continue

      const read = parseCell('option', drafts.get(optionKey))
      if (read.empty) {
        if (isPriced(option.price)) errors.set(optionKey, 'Enter a price, or NA.')
        continue
      }
      if (!read.ok) {
        errors.set(optionKey, read.error)
        continue
      }

      const to = { amount: read.value.amount, notApplicable: Boolean(read.value.notApplicable) }
      const from = { price: option.price ?? null, notApplicable: Boolean(option.priceNotApplicable) }
      const same = to.notApplicable === from.notApplicable
        && (to.notApplicable || to.amount === from.price)

      if (!same) {
        changedKeys.add(optionKey)
        changes.push({ type: 'option', plan, option, from, to })
      }
    }
  }

  return { errors, changes, changedKeys, changeCount: changedKeys.size }
}

/**
 * Merges the server's lists of Phases with an older price, one per changed price,
 * into one list: a Phase appears once, a Lot once, with all its changed prices.
 */
export function mergePhasePreviews(previews) {
  const phases = new Map()

  for (const rows of previews) {
    for (const row of rows ?? []) {
      let phase = phases.get(row.phase_id)
      if (!phase) {
        phase = { ...row, lots: [] }
        phases.set(row.phase_id, phase)
      }

      for (const lot of row.lots ?? []) {
        const known = phase.lots.find((item) => item.lot_id === lot.lot_id)
        if (!known) {
          phase.lots.push({ ...lot, option_changes: [...(lot.option_changes ?? [])] })
          continue
        }

        known.plan_change = known.plan_change ?? lot.plan_change ?? null
        for (const change of lot.option_changes ?? []) {
          if (!known.option_changes.some((item) => item.option_id === change.option_id)) {
            known.option_changes.push(change)
          }
        }
      }
    }
  }

  return [...phases.values()]
}

/** The fields a saved change covers, so the sheet can forget what it typed there. */
export function keysOfChange(change) {
  return change.type === 'option'
    ? [cellKey.option(change.option.id)]
    : [cellKey.plan(change.plan.id), cellKey.hardware(change.plan.id)]
}

/** The Plan price Hardware is checked against: the one being typed, else the saved one. */
export function effectivePlanPrice(plan, drafts) {
  const key = cellKey.plan(plan.id)
  if (drafts.has(key)) {
    const read = parseCell('plan', drafts.get(key))
    if (read.ok) return read.value.amount
  }
  return plan.price
}

/**
 * Tidies what was pasted from a spreadsheet: "$1,200.50" and "(120.50)" read as
 * 1200.50 and -120.50.
 */
export function cleanPastedPrice(text) {
  const trimmed = String(text ?? '').trim()
  const negative = /^\(.*\)$/.test(trimmed)
  const digits = trimmed.replace(/[()$,\s]/g, '')
  return negative && digits ? `-${digits}` : digits
}

/** How many prices a change covers: a Plan with its Hardware can be two. */
export function changedPriceCount(change) {
  if (change.type === 'option') return 1
  return Number(change.baseChanged) + Number(change.hardwareChanged)
}

/** "Plan 2450" or "Option OPT-12": what a change is about, for messages. */
export function describeChange(change) {
  return change.type === 'option'
    ? `Option ${change.option.code}`
    : `Plan ${change.plan.code}`
}
