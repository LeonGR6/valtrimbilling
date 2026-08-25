import { z } from 'zod'
import { MAX_DRAW_COUNT, MIN_DRAW_COUNT } from '../data/builderDrawSchedules.js'

const drawPercentageSchema = z.preprocess(
  (value) => {
    if (typeof value === 'string' && value.trim() === '') return undefined
    return Number(value)
  },
  z
    .number({
      required_error: 'Enter a percentage.',
      invalid_type_error: 'Enter a valid percentage.',
    })
    .finite('Enter a valid percentage.')
    .gt(0, 'Percentage must be greater than 0.')
    .max(100, 'Percentage cannot exceed 100%.')
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
      'Percentage can use up to two decimal places.',
    ),
)

const optionalPercentageSchema = z
  .preprocess(
    (value) => (value === '' || value === null || value === undefined ? 0 : value),
    z.coerce.number({ invalid_type_error: 'Enter a number.' }),
  )
  .refine(
    (value) => value === 0 || (value >= 1 && value <= 100),
    'Enter a percentage between 1.00 and 100.00, or leave it empty.',
  )
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
    'Use at most two decimals.',
  )

const dayOfMonthSchema = z.coerce
  .number()
  .int('Use a whole number.')
  .min(1, 'Use a day between 1 and 31.')
  .max(31, 'Use a day between 1 and 31.')

export function createBuilderDrawScheduleSchema(schedules, currentScheduleId) {
  return z
    .object({
      builderId: z.preprocess(
        (value) => Number(value),
        z.number().int().positive('Select a builder.'),
      ),
      draws: z
        .array(z.object({ percentage: drawPercentageSchema }))
        .min(MIN_DRAW_COUNT, `Configure at least ${MIN_DRAW_COUNT} draws.`)
        .max(MAX_DRAW_COUNT, `Configure no more than ${MAX_DRAW_COUNT} draws.`),
      frequency: z.enum(['MONTHLY', 'SEMIMONTHLY', 'WEEKLY']),
      cutoffDay: dayOfMonthSchema,
      submissionDay: dayOfMonthSchema,
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
      retentionEnabled: z.boolean(),
      retentionPercentage: optionalPercentageSchema,
      ocipWrapEnabled: z.boolean(),
      ocipWrapPercentage: optionalPercentageSchema,
      requiresPo: z.boolean(),
      requiresPaymentSchedule: z.boolean(),
      requiresRelease: z.boolean(),
      requiresBackup: z.boolean(),
      invoiceLineFormat: z.enum(['LOT_SCOPE', 'LOT', 'SCOPE', 'SINGLE']),
      portalName: z.string().trim().max(80, 'Use 80 characters or fewer.'),
      notes: z.string().trim().max(500, 'Use 500 characters or fewer.'),
    })
    .superRefine((data, context) => {
      const builderAlreadyConfigured = schedules.some(
        (schedule) =>
          schedule.id !== currentScheduleId
          && Number(schedule.builderId) === data.builderId,
      )

      if (builderAlreadyConfigured) {
        context.addIssue({
          code: 'custom',
          path: ['builderId'],
          message: 'This builder already has a billing and draw setup.',
        })
      }

      const total = data.draws.reduce(
        (sum, draw) => sum + draw.percentage,
        0,
      )

      if (Math.abs(total - 100) > 0.001) {
        context.addIssue({
          code: 'custom',
          path: ['draws'],
          message: 'Draw percentages must total exactly 100%.',
        })
      }

      if (data.frequency === 'SEMIMONTHLY' && data.cutoffDays.length !== 2) {
        context.addIssue({
          code: 'custom',
          path: ['cutoffDays'],
          message: 'Twice a month needs exactly two cutoff days.',
        })
      }

      if (
        data.frequency === 'SEMIMONTHLY'
        && data.cutoffDays.length === 2
        && data.cutoffDays[0] === data.cutoffDays[1]
      ) {
        context.addIssue({
          code: 'custom',
          path: ['cutoffDays'],
          message: 'The two cutoff days must be different.',
        })
      }

      if (data.retentionEnabled && data.retentionPercentage === 0) {
        context.addIssue({
          code: 'custom',
          path: ['retentionPercentage'],
          message: 'Enter the retention percentage.',
        })
      }

      if (data.ocipWrapEnabled && data.ocipWrapPercentage === 0) {
        context.addIssue({
          code: 'custom',
          path: ['ocipWrapPercentage'],
          message: 'Enter the OCIP / WRAP insurance percentage.',
        })
      }
    })
    .transform((data) => ({
      ...data,
      retentionPercentage: data.retentionEnabled ? data.retentionPercentage : 0,
      ocipWrapPercentage: data.ocipWrapEnabled ? data.ocipWrapPercentage : 0,
    }))
}
