import { z } from 'zod'

function normalizedCode(value) {
  return value.trim().toLocaleUpperCase()
}

export function createJobPlanSchema(plans, currentPlanId) {
  return z
    .object({
      code: z
        .string()
        .trim()
        .min(1, 'Enter the plan code.')
        .max(40, 'Use 40 characters or fewer.')
        .transform((value) => value.toUpperCase()),
      name: z
        .string()
        .trim()
        .max(100, 'Use 100 characters or fewer.'),
    })
    .superRefine((data, context) => {
      const duplicate = plans.some(
        (plan) =>
          plan.id !== currentPlanId &&
          normalizedCode(plan.code) === normalizedCode(data.code),
      )

      if (duplicate) {
        context.addIssue({
          code: 'custom',
          path: ['code'],
          message: 'This plan already exists in the Job sequence sheet.',
        })
      }
    })
}

export const planOptionSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Enter the P.O. / OPT # (option code).')
    .max(50, 'Use 50 characters or fewer.')
    .transform((value) => value.toUpperCase()),
  description: z
    .string()
    .trim()
    .min(1, 'Enter the option description.')
    .max(240, 'Use 240 characters or fewer.'),
})
