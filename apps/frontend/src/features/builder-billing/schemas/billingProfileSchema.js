import { z } from 'zod'

// Empty or zero means the builder does not apply it. Any real value has to be
// a percentage with at most two decimals.
const percentage = z
  .preprocess(
    (value) => (value === '' || value === null || value === undefined ? 0 : value),
    z.coerce.number({ invalid_type_error: 'Enter a number.' }),
  )
  .refine(
    (value) => value === 0 || (value >= 1 && value <= 100),
    'Enter a percentage between 1.00 and 100.00, or leave it empty.',
  )
  .refine(
    (value) => Math.round(value * 100) / 100 === value,
    'Use at most two decimals.',
  )

const dayOfMonth = z.coerce
  .number()
  .int('Use a whole number.')
  .min(1, 'Use a day between 1 and 31.')
  .max(31, 'Use a day between 1 and 31.')

// A builder may hold more than one profile, so nothing is validated across
// records — only the shape of this one.
export const billingProfileSchema = z
  .object({
    builder: z.string().min(1, 'Select a builder.'),
    frequency: z.enum(['MONTHLY', 'SEMIMONTHLY', 'WEEKLY']),

    cutoffDay: dayOfMonth,
    submissionDay: dayOfMonth,
    cutoffDays: z.array(z.coerce.number().int().min(1).max(31)),
    cutoffWeekday: z.coerce.number().int().min(0).max(6),
    submissionOffsetDays: z.coerce
      .number()
      .int('Use a whole number.')
      .min(0, 'Use 0 or more days.')
      .max(30, 'Use 30 days or fewer.'),

    workAcceptedThrough: z.enum(['CUTOFF', 'SUBMISSION']),
    invoiceDateRule: z.enum(['SUBMISSION', 'CUTOFF', 'MONTH_END']),
    paymentTermsDays: z.coerce
      .number()
      .int('Use a whole number.')
      .min(0, 'Use 0 or more days.')
      .max(180, 'Use 180 days or fewer.'),
    retentionPercentage: percentage,
    ocipWrapPercentage: percentage,

    requiresPo: z.boolean(),
    requiresPaymentSchedule: z.boolean(),
    requiresRelease: z.boolean(),
    requiresBackup: z.boolean(),

    invoiceLineFormat: z.enum(['LOT_SCOPE', 'LOT', 'SCOPE', 'SINGLE']),
    portalName: z.string().trim().max(80, 'Use 80 characters or fewer.'),
    notes: z.string().trim().max(500, 'Use 500 characters or fewer.'),
    isActive: z.boolean(),
  })
  .superRefine((data, context) => {
    if (data.frequency === 'SEMIMONTHLY' && data.cutoffDays.length !== 2) {
      context.addIssue({
        code: 'custom',
        path: ['cutoffDays'],
        message: 'Twice a month needs exactly two cutoff days.',
      })
    }

    if (
      data.frequency === 'SEMIMONTHLY' &&
      data.cutoffDays.length === 2 &&
      data.cutoffDays[0] === data.cutoffDays[1]
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cutoffDays'],
        message: 'The two cutoff days must be different.',
      })
    }
  })
