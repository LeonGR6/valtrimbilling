import { z } from 'zod'
import { MAX_DRAW_COUNT, MIN_DRAW_COUNT } from '../data/builderDrawSchedules.js'

const percentageSchema = z.preprocess(
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
    .refine((value) => Number.isInteger(value), 'Percentage must be a whole number.')
)

export function createBuilderDrawScheduleSchema(schedules, currentScheduleId) {
  return z
    .object({
      builderId: z.preprocess(
        (value) => Number(value),
        z.number().int().positive('Select a builder.'),
      ),
      draws: z
        .array(z.object({ percentage: percentageSchema }))
        .min(MIN_DRAW_COUNT, `Configure at least ${MIN_DRAW_COUNT} draws.`)
        .max(MAX_DRAW_COUNT, `Configure no more than ${MAX_DRAW_COUNT} draws.`),
    })
    .superRefine((data, context) => {
      const builderAlreadyConfigured = schedules.some(
        (schedule) =>
          schedule.id !== currentScheduleId &&
          Number(schedule.builderId) === data.builderId,
      )

      if (builderAlreadyConfigured) {
        context.addIssue({
          code: 'custom',
          path: ['builderId'],
          message: 'This builder already has a draw schedule.',
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
    })
}
