import { z } from 'zod'

export function createPlanTypeSchema(planTypes, currentPlanTypeId) {
  return z
    .object({
      builder: z.string().min(1, 'Select a builder.'),
      code: z
        .string()
        .trim()
        .min(1, 'Enter a plan code.')
        .max(24, 'Use 24 characters or fewer.')
        .transform((value) => value.toUpperCase()),
      name: z
        .string()
        .trim()
        .min(1, 'Enter a plan name.')
        .max(80, 'Use 80 characters or fewer.'),
      planPrice: z.string().trim().max(240, 'Use 240 characters or fewer.'),
      isActive: z.boolean(),
    })
    .superRefine((data, context) => {
      const codeAlreadyExists = planTypes.some(
        (item) =>
          item.id !== currentPlanTypeId &&
          item.builder === data.builder &&
          item.code.trim().toUpperCase() === data.code,
      )

      if (codeAlreadyExists) {
        context.addIssue({
          code: 'custom',
          path: ['code'],
          message: 'This code already exists for the selected builder.',
        })
      }
    })
}
