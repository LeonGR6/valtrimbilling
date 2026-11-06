import { z } from 'zod'
import { MAX_DRAW_COUNT, MIN_DRAW_COUNT, submissionMethodOptions } from '../data/builderDrawSchedules.js'
import { LAG_UNITS, lagLimit } from '../utils/drawLag.js'

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

/**
 * The percentage a typed value stands for when it was entered as a fraction
 * (0.0833 for 8.33%), or null when it is not one. A percentage here is never
 * below 1, so anything above 0 and under 1 can only be a fraction. The result
 * keeps the two decimals the database stores (0.08333 gives 8.33).
 */
export function percentageFromFraction(value) {
  if (value === '' || value === null || value === undefined) return null

  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0 || number >= 1) return null

  return Math.round(number * 10000) / 100
}

const optionalPercentageSchema = z
  .preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined) return 0
      return percentageFromFraction(value) ?? value
    },
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

// OCIP / WRAP insurance is usually a small share: from 0.001% up to 10%. It is
// typed as a percentage, never as a fraction (0.05 is 0.05%, not 5%), and it
// keeps three decimals, which is what the database stores.
export const WRAP_PERCENTAGE_MIN = 0.001
export const WRAP_PERCENTAGE_MAX = 10

const wrapPercentageSchema = z
  .preprocess(
    (value) => (value === '' || value === null || value === undefined ? 0 : value),
    z.coerce.number({ invalid_type_error: 'Enter a number.' }),
  )
  .refine(
    (value) => value === 0
      || (value >= WRAP_PERCENTAGE_MIN && value <= WRAP_PERCENTAGE_MAX),
    `Enter a percentage between ${WRAP_PERCENTAGE_MIN} and ${WRAP_PERCENTAGE_MAX}, or leave it empty.`,
  )
  .refine(
    (value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 0.000001,
    'Use at most three decimals.',
  )

const eventPercentageSchema = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? 0 : value),
  z.coerce
    .number({ invalid_type_error: 'Enter a valid percentage.' })
    .finite('Enter a valid percentage.')
    .min(0, 'Percentage cannot be negative.')
    .max(100, 'Percentage cannot exceed 100%.')
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
      'Use at most two decimals.',
    ),
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

// How long after its event a Draw is billed. Empty (null) means on the event date.
const lagSchema = z.preprocess(
  (value) => (
    value == null || value.value === '' || value.value == null ? null : value
  ),
  z.object({
    value: z.preprocess(
      (value) => Number(value),
      z.number({ invalid_type_error: 'Enter a number.' })
        .int('Use a whole number.')
        .min(1, 'Use 1 or more.'),
    ),
    unit: z.enum(LAG_UNITS, { message: 'Select days, weeks or months.' }),
  }).nullable(),
).default(null)

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
          lag: lagSchema,
        }))
        .min(MIN_DRAW_COUNT, `Configure at least ${MIN_DRAW_COUNT} draws.`)
        .max(MAX_DRAW_COUNT, `Configure no more than ${MAX_DRAW_COUNT} draws.`),
      separateHardwarePrice: z.boolean().default(false),
      hardwareBillingMode: z.enum(['FULL', 'BY_EVENT']).default('FULL'),
      hardwareEventPercentages: z.object({
        EXT: eventPercentageSchema,
        DM: eventPercentageSchema,
        HW: eventPercentageSchema,
      }),
      utilityBuilding: z.boolean().default(false),
      utilityBillingMode: z.enum(['FULL', 'BY_EVENT']).default('FULL'),
      utilityEventPercentages: z.object({
        EXT: eventPercentageSchema,
        DM: eventPercentageSchema,
        HW: eventPercentageSchema,
      }),
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
      retentionReleaseScope: z.enum(['BUILDING', 'JOB']).default('JOB'),
      ocipWrapEnabled: z.boolean(),
      ocipWrapPercentage: wrapPercentageSchema,
      requiresPo: z.boolean(),
      requiresPaymentSchedule: z.boolean(),
      requiresRelease: z.boolean(),
      finalReleaseScope: z.enum(['', 'PHASE', 'BUILDING', 'PROJECT']).default(''),
      singleInvoiceScope: z.enum(['', 'PHASE', 'BUILDING']).default(''),
      requiresBackup: z.boolean(),
      invoiceLineFormat: z.enum(['LOT_SCOPE', 'BUILDING_SCOPE']),
      submissionMethod: z.enum(submissionMethodOptions.map((option) => option.value)),
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

      if (data.requiresRelease && !data.finalReleaseScope) {
        context.addIssue({
          code: 'custom',
          path: ['finalReleaseScope'],
          message: 'Select where the Conditional Final Release applies.',
        })
      }

      data.draws.forEach((draw, index) => {
        if (!draw.lag) return

        if (draw.lag.value > lagLimit(draw.lag.unit)) {
          context.addIssue({
            code: 'custom',
            path: ['draws', index, 'lag'],
            message: `Use ${lagLimit(draw.lag.unit)} or fewer.`,
          })
        }

        const sharesEvent = data.draws.some(
          (other, otherIndex) => otherIndex !== index && other.eventType === draw.eventType,
        )
        if (!sharesEvent) {
          context.addIssue({
            code: 'custom',
            path: ['draws', index, 'lag'],
            message: 'A lag needs another Draw with the same event.',
          })
        }
      })

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

      if (data.separateHardwarePrice) {
        const hardwareTotal = Object.values(data.hardwareEventPercentages).reduce(
          (sum, percentage) => sum + percentage,
          0,
        )

        if (
          data.hardwareBillingMode !== 'BY_EVENT'
          || Math.abs(hardwareTotal - 100) > 0.001
        ) {
          context.addIssue({
            code: 'custom',
            path: ['hardwareEventPercentages'],
            message: 'Hardware event percentages must total exactly 100%.',
          })
        }
      }

      if (data.utilityBuilding && data.utilityBillingMode === 'BY_EVENT') {
        const configuredEvents = new Set(data.draws.map((draw) => draw.eventType))
        const utilityTotal = Object.values(data.utilityEventPercentages).reduce(
          (sum, percentage) => sum + percentage,
          0,
        )

        if (Math.abs(utilityTotal - 100) > 0.001) {
          context.addIssue({
            code: 'custom',
            path: ['utilityEventPercentages'],
            message: 'Utility event percentages must total exactly 100%.',
          })
        }

        for (const [eventType, percentage] of Object.entries(
          data.utilityEventPercentages,
        )) {
          if (percentage > 0 && !configuredEvents.has(eventType)) {
            context.addIssue({
              code: 'custom',
              path: ['utilityEventPercentages', eventType],
              message: `Add a ${eventType} Draw or set its Utility percentage to 0%.`,
            })
          }
        }
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
      hardwareBillingMode: data.separateHardwarePrice ? 'BY_EVENT' : 'FULL',
      hardwareEventPercentages: data.separateHardwarePrice
        ? data.hardwareEventPercentages
        : { EXT: 0, DM: 0, HW: 0 },
      utilityBillingMode: data.utilityBuilding
        ? data.utilityBillingMode
        : 'FULL',
      utilityEventPercentages: data.utilityBuilding
        && data.utilityBillingMode === 'BY_EVENT'
        ? data.utilityEventPercentages
        : { EXT: 0, DM: 0, HW: 0 },
      anyDate: data.frequency === 'MONTHLY' && data.anyDate,
      cutoffDay: data.frequency === 'MONTHLY' && !data.anyDate
        ? data.cutoffDay
        : null,
      retentionPercentage: data.retentionEnabled ? data.retentionPercentage : 0,
      ocipWrapPercentage: data.ocipWrapEnabled ? data.ocipWrapPercentage : 0,
    }))
}
