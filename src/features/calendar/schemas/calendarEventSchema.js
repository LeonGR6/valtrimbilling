import { z } from 'zod'

const requiredText = (message, max = 100) => z
  .string()
  .trim()
  .min(1, message)
  .max(max, `Use ${max} characters or fewer.`)

export const calendarEventSchema = z.object({
    code: requiredText('Enter the work code.', 12)
      .transform((value) => value.toUpperCase()),
    workType: requiredText('Enter the work type.'),
    lots: requiredText('Enter at least one lot or unit.'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select a valid date.'),
    builder: requiredText('Enter the builder.'),
    community: requiredText('Enter the community.'),
    phase: requiredText('Enter the phase.', 30),
    building: requiredText('Enter the building.', 30),
    status: z.enum(['Confirmed', 'In progress', 'Completed', 'Exception']),
    plan: requiredText('Enter the plan.', 30),
    rate: z.coerce.number().min(0, 'The rate cannot be negative.'),
    progress: z.number().min(0).max(100).optional(),
    billingReady: z.boolean().optional(),
  })
