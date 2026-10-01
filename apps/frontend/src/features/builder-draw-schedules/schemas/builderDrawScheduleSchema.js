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
    .max(99, 'Percentage cannot exceed 99%.')
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

const optionalDayOfMonthSchema = z.preprocess(
  (value) => (value === '' || value === null || value === undefined
    ? null
    : Number(value)),
  z.number()
    .int('Use a whole number.')
    .min(1, 'Use a day between 1 and 31.')
    .max(31, 'Use a day between 1 and 31.')
    .nullable(),
)

const optionalDrawIndexSchema = z.preprocess(
  (value) => (value === '' || value === null || value === undefined
    ? null
    : Number(value)),
  z.number().int().min(0).nullable(),
)

const emailAddressSchema = z.string().email()

export function createBuilderDrawScheduleSchema(schedules, currentScheduleId) {
  return z
    .object({
      builderId: z.preprocess(
        (value) => Number(value),
        z.number().int().positive('Select a builder.'),
      ),
      draws: z
        .array(z.object({
          name: z
            .string()
            .trim()
            .max(80, 'Use 80 characters or fewer.')
            .default(''),
          percentage: drawPercentageSchema,
          eventType: z.preprocess(
            (value) => value ?? '',
            z.string().trim().refine(
              (value) => ['EXT', 'DM', 'HW'].includes(value),
              'Select EXT, DM or HW.',
            ),
          ),
        }))
        .min(MIN_DRAW_COUNT, `Configure at least ${MIN_DRAW_COUNT} draws.`)
        .max(MAX_DRAW_COUNT, `Configure no more than ${MAX_DRAW_COUNT} draws.`),
      separateHardwarePrice: z.boolean().default(false),
      utilityBuilding: z.boolean().default(false),
      optionsBillingDrawIndex: optionalDrawIndexSchema,
      frequency: z.enum(['MONTHLY', 'SEMIMONTHLY', 'WEEKLY']),
      anyDate: z.boolean().default(false),
      cutoffDay: optionalDayOfMonthSchema,
      cutoffDays: z.array(z.coerce.number().int().min(1).max(31)),
      cutoffWeekday: z.coerce.number().int().min(0).max(6),
      paymentTermsDays: z.coerce
        .number()
        .int('Use a whole number.')
        .min(0, 'Use 0 or more days.')
        .max(180, 'Use 180 days or fewer.'),
      retentionEnabled: z.boolean().default(false),
      retentionPercentage: optionalPercentageSchema,
      ocipWrapEnabled: z.boolean(),
      ocipWrapPercentage: optionalPercentageSchema,
      requiresPo: z.boolean(),
      requiresPaymentSchedule: z.boolean(),
      requiresRelease: z.boolean(),
      requiresBackup: z.boolean(),
      invoiceLineFormat: z.enum(['LOT_SCOPE', 'BUILDING_SCOPE']),
      submissionMethod: z.enum(['PORTAL', 'EMAIL', 'MAIL']),
      submissionDestination: z
        .string()
        .trim()
        .max(500, 'Use 500 characters or fewer.'),
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

      if (
        data.optionsBillingDrawIndex !== null
        && data.optionsBillingDrawIndex >= data.draws.length
      ) {
        context.addIssue({
          code: 'custom',
          path: ['optionsBillingDrawIndex'],
          message: 'Select one of the configured draws.',
        })
      }

      if (
        data.frequency === 'MONTHLY'
        && !data.anyDate
        && data.cutoffDay === null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['cutoffDay'],
          message: 'Enter the monthly cutoff date.',
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

      if (
        data.submissionMethod === 'PORTAL'
        && data.submissionDestination.length > 80
      ) {
        context.addIssue({
          code: 'custom',
          path: ['submissionDestination'],
          message: 'Use 80 characters or fewer.',
        })
      }

      if (data.submissionMethod === 'EMAIL') {
        if (!data.submissionDestination) {
          context.addIssue({
            code: 'custom',
            path: ['submissionDestination'],
            message: 'Enter the submission email.',
          })
        } else if (
          data.submissionDestination.length > 254
          || !emailAddressSchema.safeParse(data.submissionDestination).success
        ) {
          context.addIssue({
            code: 'custom',
            path: ['submissionDestination'],
            message: 'Enter a valid email address.',
          })
        }
      }

      if (
        data.submissionMethod === 'MAIL'
        && !data.submissionDestination
      ) {
        context.addIssue({
          code: 'custom',
          path: ['submissionDestination'],
          message: 'Enter the mailing address.',
        })
      }

      const totalDeductions = (data.retentionEnabled
        ? data.retentionPercentage
        : 0) + (data.ocipWrapEnabled ? data.ocipWrapPercentage : 0)

      if (totalDeductions > 100) {
        context.addIssue({
          code: 'custom',
          path: ['ocipWrapPercentage'],
          message: 'Retention and OCIP / WRAP cannot exceed 100% combined.',
        })
      }
    })
    .transform((data) => ({
      ...data,
      anyDate: data.frequency === 'MONTHLY' && data.anyDate,
      cutoffDay: data.frequency === 'MONTHLY' && !data.anyDate
        ? data.cutoffDay
        : null,
      retentionPercentage: data.retentionEnabled ? data.retentionPercentage : 0,
      ocipWrapPercentage: data.ocipWrapEnabled ? data.ocipWrapPercentage : 0,
    }))
}
