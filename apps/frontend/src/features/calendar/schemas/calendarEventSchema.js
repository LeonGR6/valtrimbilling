import { z } from 'zod'

const requiredText = (message, max = 100) => z
  .string()
  .trim()
  .min(1, message)
  .max(max, `Use ${max} characters or fewer.`)

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select a valid date.')
const lotField = z.coerce.number().int('Use a whole lot number.').min(1, 'Lots must start at 1.')

const splitPartSchema = z.object({
  id: z.string(),
  lotStart: lotField,
  lotEnd: lotField,
  date: dateField,
})

function validateSplitParts(value, context, enabledField, partsField) {
  if (!value[enabledField]) return

  const parts = value[partsField]
  if (parts.length < 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [partsField],
      message: 'Add at least two lot groups for a split phase.',
    })
    return
  }

  const sortedParts = [...parts].sort((a, b) => a.lotStart - b.lotStart)
  const allRangesValid = sortedParts.every((part) => part.lotEnd >= part.lotStart)
  const coversFullRange = sortedParts[0]?.lotStart === value.lotStart
    && sortedParts.at(-1)?.lotEnd === value.lotEnd
  const hasNoGaps = sortedParts.every((part, index) => (
    index === 0 || part.lotStart === sortedParts[index - 1].lotEnd + 1
  ))

  if (!allRangesValid || !coversFullRange || !hasNoGaps) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [partsField],
      message: `Split groups must cover lots ${value.lotStart}–${value.lotEnd} once, without gaps.`,
    })
  }
}

export const productionActivitySchema = z.object({
  calendarType: z.literal('PRODUCTION').default('PRODUCTION'),
  jobId: z.coerce.number().int().positive('Select a job.'),
  phaseId: z.coerce.number().int().positive('Select a phase.'),
  jobCode: requiredText('Select a job.', 40),
  builder: requiredText('The selected job needs a builder.'),
  community: requiredText('The selected job needs a community.'),
  phase: requiredText('Select a phase.', 40),
  building: requiredText('The selected phase needs a building.', 40),
  lotStart: lotField,
  lotEnd: lotField,
  lotNumbers: z.array(requiredText('Every lot needs a number.', 40)).min(1, 'The selected phase has no lots.'),
  foreman: z.string().trim().max(100, 'Use 100 characters or fewer.').optional().default(''),
  superintendent: z.string().trim().max(100, 'Use 100 characters or fewer.').optional().default(''),
  notes: z.string().trim().max(500, 'Use 500 characters or fewer.').optional().default(''),
  extDate: dateField,
  extOrderMaterial: z.boolean().default(false),
  extInstallOnly: z.boolean().default(false),
  extInstallDate: z.string().default(''),
  dmDate: dateField,
  dmInstallOnly: z.boolean().default(false),
  dmInstallDate: z.string().default(''),
  dmSplitPhase: z.boolean().default(false),
  dmSplitParts: z.array(splitPartSchema).default([]),
  dmShutters: z.boolean().default(false),
  hwDate: dateField,
  hwSplitPhase: z.boolean().default(false),
  hwSplitParts: z.array(splitPartSchema).default([]),
  hwLockUp: z.boolean().default(false),
}).superRefine((value, context) => {
  if (value.lotEnd < value.lotStart) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lotEnd'],
      message: 'The selected phase has an invalid lot range.',
    })
  }

  if (value.extInstallOnly && !/^\d{4}-\d{2}-\d{2}$/.test(value.extInstallDate)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['extInstallDate'],
      message: 'Select the EXT install-only date.',
    })
  }

  if (value.dmInstallOnly && !/^\d{4}-\d{2}-\d{2}$/.test(value.dmInstallDate)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dmInstallDate'],
      message: 'Select the DM install-only date.',
    })
  }

  validateSplitParts(value, context, 'dmSplitPhase', 'dmSplitParts')
  validateSplitParts(value, context, 'hwSplitPhase', 'hwSplitParts')
})

// Keep the original export name while the calendar moves from one event per
// form to a grouped Production activity.
export const calendarEventSchema = productionActivitySchema
