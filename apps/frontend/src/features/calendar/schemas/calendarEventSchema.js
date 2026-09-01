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

export const calendarEventSchema = z.object({
  activityType: z.enum(['EXT', 'DM', 'HW']),
  lotStart: lotField,
  lotEnd: lotField,
  date: dateField,
  builder: requiredText('Enter the builder.'),
  community: requiredText('Enter the community.'),
  phase: requiredText('Enter the phase.', 40),
  building: requiredText('Enter the building.', 40),
  foreman: z.string().trim().max(100, 'Use 100 characters or fewer.').optional().default(''),
  notes: z.string().trim().max(500, 'Use 500 characters or fewer.').optional().default(''),
  installOnly: z.boolean().default(false),
  installDate: z.string().default(''),
  splitPhase: z.boolean().default(false),
  splitParts: z.array(splitPartSchema).default([]),
  lockUp: z.boolean().default(false),
}).superRefine((value, context) => {
  if (value.lotEnd < value.lotStart) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lotEnd'],
      message: 'The ending lot must be equal to or greater than the starting lot.',
    })
  }

  if (value.installOnly) {
    if (value.activityType === 'HW') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['installOnly'],
        message: 'Install only is available for EXT FRAMES and DM activities.',
      })
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.installDate)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['installDate'],
        message: 'Select the install-only date.',
      })
    }
  }

  if (!value.splitPhase) return

  if (value.splitParts.length < 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['splitParts'],
      message: 'Add at least two lot groups for a split phase.',
    })
    return
  }

  const sortedParts = [...value.splitParts].sort((a, b) => a.lotStart - b.lotStart)

  for (const [index, part] of sortedParts.entries()) {
    if (part.lotEnd < part.lotStart) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['splitParts', index, 'lotEnd'],
        message: 'Each division needs a valid lot range.',
      })
    }
  }

  const coversFullRange = sortedParts[0]?.lotStart === value.lotStart
    && sortedParts.at(-1)?.lotEnd === value.lotEnd
  const hasNoGaps = sortedParts.every((part, index) => (
    index === 0 || part.lotStart === sortedParts[index - 1].lotEnd + 1
  ))

  if (!coversFullRange || !hasNoGaps) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['splitParts'],
      message: `Split groups must cover lots ${value.lotStart}–${value.lotEnd} once, without gaps.`,
    })
  }
})
