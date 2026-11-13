// The bulk mode of Plans & Options: the Job's Plans and Options as a grid to edit and delete from,
// with rows below to add more (typed or pasted), read for what saving would do. Pure: nothing here
// touches the network or React.
//
// An added row is one Option under a Plan. A blank Plan takes the Plan of the row above, so a Plan is
// typed once and its Options listed under it. A row with only a Plan creates (or finds) the Plan.

export const BULK_COLUMNS = ['plan', 'code', 'description', 'planName']

export const MAX_PLAN_CODE = 40
export const MAX_PLAN_NAME = 100
export const MAX_OPTION_CODE = 40
export const MAX_OPTION_DESCRIPTION = 240

let rowCounter = 0

export function createBulkRow(values = {}) {
  rowCounter += 1
  return { id: `bulk-row-${rowCounter}`, plan: '', code: '', description: '', planName: '', ...values }
}

function filled(value) {
  return String(value ?? '').trim() !== ''
}

export function isBlankRow(row) {
  return !BULK_COLUMNS.some((column) => filled(row[column]))
}

/** The grid always ends with one blank row to type into. */
export function withTrailingBlankRow(rows) {
  const last = rows.at(-1)
  return last && isBlankRow(last) ? rows : [...rows, createBulkRow()]
}

const normalizedCode = (value) => String(value ?? '').trim().toUpperCase()
const normalizedDescription = (value) => String(value ?? '').trim().toLowerCase()
const optionKey = (planCode, code, description) => (
  `${planCode}\u0000${code}\u0000${normalizedDescription(description)}`
)

// ---------------------------------------------------------------------------------------------
// Existing Plans and Options as rows

/**
 * The Job's Plans and Options as rows to edit: a row for each Plan, followed by one for each of its
 * Options. A row keeps what it had (`original`), so an edit is what differs from it, and the row
 * of an Option keeps the Plan it belongs to: an Option is edited, not moved to another Plan.
 */
export function createExistingRows(plans = []) {
  return plans.flatMap((plan) => {
    const name = String(plan.name ?? '').trim()
    const options = plan.options ?? []

    return [
      {
        id: `plan-${plan.id}`,
        kind: 'plan',
        planId: plan.id,
        plan: plan.code,
        planName: name,
        optionCount: options.length,
        original: { plan: plan.code, planName: name },
      },
      ...options.map((option) => {
        const description = String(option.description ?? '').trim()
        return {
          id: `option-${option.id}`,
          kind: 'option',
          planId: plan.id,
          optionId: option.id,
          code: option.code,
          description,
          original: { code: option.code, description },
        }
      }),
    ]
  })
}

/** The row with what it had before it was edited. */
export function revertedRow(row) {
  return { ...row, ...row.original }
}

/**
 * What saving would do, row by row. `existing` are the rows of createExistingRows (with the edits
 * made to them), `added` the rows typed or pasted below them, and `deleted` the ids of the existing
 * rows marked for deletion (a Plan takes its Options with it).
 *
 * Returns:
 *   existing  the result of each existing row by id: `{ status, message, was }`, status one of
 *             'unchanged' | 'edited' | 'error' | 'delete' | 'delete-with-plan'
 *   added     one result per added row, in order: `{ status, message, planCode, creates }`, status
 *             'empty' | 'error' | 'option' (a new Option) | 'plan' (a Plan only) | 'skip' (already there)
 *   payload   the changes to send (see apply_plan_option_changes)
 *   summary   how many of each, and how many rows have to be fixed
 *   canSave   nothing to fix and something to change
 */
export function evaluateBulkChanges({ existing = [], added = [], deleted = new Set() }) {
  const results = new Map()
  let errorCount = 0
  const fail = (rowId, message) => {
    errorCount += 1
    results.set(rowId, { status: 'error', message })
  }

  const planRows = existing.filter((row) => row.kind === 'plan')
  const deletedPlanRows = planRows.filter((row) => deleted.has(row.id))
  const deletedPlanIds = new Set(deletedPlanRows.map((row) => row.planId))
  // A deleted Plan keeps its code (it can be brought back), so no other Plan can take it.
  const deletedPlanCodes = new Set(deletedPlanRows.map((row) => normalizedCode(row.original.plan)))

  // Plans --------------------------------------------------------------------------------------
  const planCodeToId = new Map()
  const planUpdates = []

  for (const row of planRows) {
    if (deleted.has(row.id)) {
      results.set(row.id, { status: 'delete', message: '' })
      continue
    }

    const code = normalizedCode(row.plan)
    const name = String(row.planName ?? '').trim()

    if (!code) {
      fail(row.id, 'Enter the Plan code.')
    } else if (code.length > MAX_PLAN_CODE) {
      fail(row.id, `The Plan code is over ${MAX_PLAN_CODE} characters.`)
    } else if (name.length > MAX_PLAN_NAME) {
      fail(row.id, `The Plan name is over ${MAX_PLAN_NAME} characters.`)
    } else if (planCodeToId.has(code)) {
      fail(row.id, 'Another Plan already has this code.')
    } else if (deletedPlanCodes.has(code)) {
      fail(row.id, 'This code belongs to a Plan you are deleting.')
    } else {
      planCodeToId.set(code, row.planId)
      const wasCode = normalizedCode(row.original.plan)
      const wasName = String(row.original.planName ?? '').trim()

      if (code !== wasCode || name !== wasName) {
        planUpdates.push({ id: row.planId, code, name })
        results.set(row.id, {
          status: 'edited',
          message: 'Edited',
          was: [row.original.plan, wasName].filter(Boolean).join(' · '),
        })
      } else {
        results.set(row.id, { status: 'unchanged', message: '' })
      }
    }
  }

  // Options of Plans that stay ---------------------------------------------------------------------
  const optionRows = existing.filter((row) => row.kind === 'option')
  const optionKeys = new Map() // plan id → key → how many Options have it now
  const current = new Map() // row id → { code, description }

  for (const row of optionRows) {
    if (deletedPlanIds.has(row.planId)) continue
    if (deleted.has(row.id)) continue

    const code = normalizedCode(row.code)
    const description = String(row.description ?? '').trim() || code
    current.set(row.id, { code, description })
    const keys = optionKeys.get(row.planId) ?? new Map()
    const key = optionKey('', code, description)
    keys.set(key, (keys.get(key) ?? 0) + 1)
    optionKeys.set(row.planId, keys)
  }

  const optionUpdates = []
  const deletedOptionIds = []
  let optionsDeletedWithPlans = 0

  for (const row of optionRows) {
    if (deletedPlanIds.has(row.planId)) {
      optionsDeletedWithPlans += 1
      results.set(row.id, { status: 'delete-with-plan', message: '' })
      continue
    }
    if (deleted.has(row.id)) {
      deletedOptionIds.push(row.optionId)
      results.set(row.id, { status: 'delete', message: '' })
      continue
    }

    const { code, description } = current.get(row.id)
    const wasCode = normalizedCode(row.original.code)
    const wasDescription = String(row.original.description ?? '').trim() || wasCode

    if (!code) {
      fail(row.id, 'Enter the OPT #.')
    } else if (code.length > MAX_OPTION_CODE) {
      fail(row.id, `The OPT # is over ${MAX_OPTION_CODE} characters.`)
    } else if (description.length > MAX_OPTION_DESCRIPTION) {
      fail(row.id, `The description is over ${MAX_OPTION_DESCRIPTION} characters.`)
    } else if (code === wasCode && description === wasDescription) {
      results.set(row.id, { status: 'unchanged', message: '' })
    } else if ((optionKeys.get(row.planId)?.get(optionKey('', code, description)) ?? 0) > 1) {
      fail(row.id, 'The Plan already has an Option with this OPT # and description.')
    } else {
      optionUpdates.push({ id: row.optionId, code, description })
      results.set(row.id, {
        status: 'edited',
        message: 'Edited',
        was: [row.original.code, wasDescription !== normalizedCode(row.original.code) ? wasDescription : '']
          .filter(Boolean).join(' · '),
      })
    }
  }

  // Added rows ---------------------------------------------------------------------------------
  const seenPlans = new Set()
  const payloadPlans = new Map()
  const optionAdds = []
  const addedResults = []
  let inherited = ''
  let optionsSkipped = 0

  for (const row of added) {
    if (isBlankRow(row)) {
      addedResults.push({ status: 'empty', message: '', planCode: '', creates: false })
      continue
    }

    const planCode = normalizedCode(row.plan) || inherited
    const code = normalizedCode(row.code)
    const description = String(row.description ?? '').trim()
    const planName = String(row.planName ?? '').trim()
    const error = (message) => {
      errorCount += 1
      return { status: 'error', message, planCode, creates: false }
    }

    if (!planCode) {
      addedResults.push(error('Enter the Plan, or put this row under one.'))
      continue
    }
    if (planCode.length > MAX_PLAN_CODE) {
      // The rows below cannot take a Plan that is not valid.
      inherited = ''
      addedResults.push(error(`The Plan code is over ${MAX_PLAN_CODE} characters.`))
      continue
    }
    // From here the Plan is valid: a row with another problem still keeps the Plan for the rows below
    // it, so one mistake does not move their Options to the Plan above.
    inherited = planCode
    if (planName.length > MAX_PLAN_NAME) {
      addedResults.push(error(`The Plan name is over ${MAX_PLAN_NAME} characters.`))
      continue
    }
    if (code.length > MAX_OPTION_CODE) {
      addedResults.push(error(`The OPT # is over ${MAX_OPTION_CODE} characters.`))
      continue
    }
    if (!code && description) {
      addedResults.push(error('Enter the OPT # for this description.'))
      continue
    }
    const optionDescription = description || code
    if (optionDescription.length > MAX_OPTION_DESCRIPTION) {
      addedResults.push(error(`The description is over ${MAX_OPTION_DESCRIPTION} characters.`))
      continue
    }
    if (deletedPlanCodes.has(planCode) && !planCodeToId.has(planCode)) {
      addedResults.push(error('This Plan is being deleted.'))
      continue
    }

    const existingPlanId = planCodeToId.get(planCode)
    const planExists = existingPlanId !== undefined
    const creates = !planExists && !seenPlans.has(planCode)
    seenPlans.add(planCode)

    let entry = payloadPlans.get(planCode)
    if (!planExists && !entry) {
      entry = { code: planCode, name: '', options: [] }
      payloadPlans.set(planCode, entry)
    }
    // The name only matters for a Plan that is created; the first one typed is the one used.
    if (entry && !entry.name && planName) entry.name = planName

    if (!code) {
      addedResults.push({
        status: 'plan',
        message: planExists ? 'The Plan is already in the Job.' : 'New Plan',
        planCode,
        creates,
      })
      continue
    }

    const keys = planExists
      ? (optionKeys.get(existingPlanId) ?? new Map())
      : (entry.keys ??= new Map())
    const key = optionKey('', code, optionDescription)
    if (planExists) optionKeys.set(existingPlanId, keys)

    if (keys.has(key)) {
      optionsSkipped += 1
      addedResults.push({ status: 'skip', message: 'Already in the Plan, skipped.', planCode, creates })
      continue
    }

    keys.set(key, 1)
    if (planExists) optionAdds.push({ plan_id: existingPlanId, code, description: optionDescription })
    else entry.options.push({ code, description: optionDescription })
    addedResults.push({ status: 'option', message: 'New Option', planCode, creates })
  }

  const newPlans = [...payloadPlans.values()].map(({ code, name, options }) => ({ code, name, options }))
  const payload = {
    new_plans: newPlans,
    option_adds: optionAdds,
    plan_updates: planUpdates,
    option_updates: optionUpdates,
    deleted_plans: deletedPlanRows.map((row) => row.planId),
    deleted_options: deletedOptionIds,
  }
  const summary = {
    newPlans: newPlans.length,
    newOptions: newPlans.reduce((sum, plan) => sum + plan.options.length, 0) + optionAdds.length,
    optionsSkipped,
    plansEdited: planUpdates.length,
    optionsEdited: optionUpdates.length,
    plansDeleted: deletedPlanRows.length,
    optionsDeleted: deletedOptionIds.length,
    optionsDeletedWithPlans,
    errorCount,
  }
  const changeCount = summary.newPlans + summary.newOptions + summary.plansEdited
    + summary.optionsEdited + summary.plansDeleted + summary.optionsDeleted

  return {
    existing: results,
    added: addedResults,
    payload,
    summary,
    canSave: errorCount === 0 && changeCount > 0,
    hasChanges: changeCount > 0,
  }
}

/** The bar's line: what saving would do. */
export function describeBulkSummary(summary) {
  const count = (number, singular, pluralForm = `${singular}s`) => `${number} ${number === 1 ? singular : pluralForm}`
  const parts = []
  if (summary.newPlans > 0) parts.push(`${count(summary.newPlans, 'new plan')}`)
  if (summary.newOptions > 0) parts.push(`${count(summary.newOptions, 'new option')}`)
  const edited = (summary.plansEdited ?? 0) + (summary.optionsEdited ?? 0)
  if (edited > 0) parts.push(`${edited} edited`)
  const deleted = (summary.plansDeleted ?? 0) + (summary.optionsDeleted ?? 0)
  if (deleted > 0) parts.push(`${deleted} to delete`)
  return parts.length > 0 ? parts.join(' · ') : 'No changes yet'
}

/** What to tell the person once it is saved (`result` is what the database returned). */
export function describeBulkResult(result) {
  const count = (number, singular, pluralForm = `${singular}s`) => `${number} ${number === 1 ? singular : pluralForm}`
  const plansAdded = result.plansCreated + result.plansRestored
  const added = []
  if (plansAdded > 0) added.push(count(plansAdded, 'plan'))
  if (result.optionsCreated > 0) added.push(count(result.optionsCreated, 'option'))
  const edited = result.plansUpdated + result.optionsUpdated
  const deleted = result.plansDeleted + result.optionsDeleted

  const sentences = []
  if (added.length > 0) sentences.push(`Added ${added.join(' and ')}.`)
  if (edited > 0) sentences.push(`Edited ${edited}.`)
  if (deleted > 0) sentences.push(`Deleted ${deleted}.`)
  if (sentences.length === 0) sentences.push('Nothing new to add.')
  if (result.optionsSkipped > 0) {
    sentences.push(`${count(result.optionsSkipped, 'option was', 'options were')} already there.`)
  }
  return sentences.join(' ')
}

// Cells copied from a spreadsheet: tab between columns, a line per row; a cell with a line break or
// a quote comes wrapped in quotes.
export function parseSpreadsheetText(text) {
  const normalized = String(text ?? '').replace(/\r\n?/gu, '\n').replace(/\n+$/u, '')
  if (normalized === '') return []

  return normalized.split('\n').map((line) => line.split('\t').map((cell) => {
    const trimmed = cell.trim()
    return /^".*"$/u.test(trimmed) && trimmed.length >= 2
      ? trimmed.slice(1, -1).replace(/""/gu, '"')
      : trimmed
  }))
}

const HEADER_WORDS = new Set([
  'plan', 'plan code', 'plan #', 'plans',
  'opt', 'opt #', 'opt#', 'option', 'option code', 'options',
  'description', 'option description', 'desc',
  'plan name', 'name',
])

/** A first line made only of column names ("Plan", "OPT #", "Description") is not data. */
export function looksLikeHeader(cells) {
  const used = cells.filter(filled)
  // "Plan name (optional)" is a column name too: what is in parentheses does not count.
  const word = (cell) => cell.replace(/\(.*?\)/gu, '').trim().toLowerCase()
  return used.length > 0 && used.every((cell) => HEADER_WORDS.has(word(cell)))
}

/**
 * Puts pasted cells into the grid, from the row and column where they were pasted, adding rows
 * when there are more lines than rows. A column that does not exist is left out.
 */
export function applyPastedCells(rows, startRow, startColumn, matrix) {
  const lines = looksLikeHeader(matrix[0] ?? []) && matrix.length > 1 ? matrix.slice(1) : matrix
  const next = rows.map((row) => ({ ...row }))

  lines.forEach((cells, offset) => {
    const index = startRow + offset
    while (next.length <= index) next.push(createBulkRow())
    cells.forEach((cell, columnOffset) => {
      const column = BULK_COLUMNS[startColumn + columnOffset]
      if (column) next[index][column] = cell
    })
  })

  return withTrailingBlankRow(next)
}
