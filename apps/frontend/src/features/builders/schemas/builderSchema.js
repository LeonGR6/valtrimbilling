import { z } from 'zod'

const namePattern = /^[\p{L}\s'-]*$/u
const phonePattern = /^[\d\s()+-]*$/

export function createBuilderSchema(builders, currentBuilderId) {
  return z
    .object({
      code: z
        .string()
        .trim()
        .min(1, 'Enter a builder code.')
        .max(24, 'Use 24 characters or fewer.')
        .transform((value) => value.toUpperCase()),
      name: z
        .string()
        .trim()
        .min(1, 'Enter a builder name.')
        .max(100, 'Use 100 characters or fewer.')
        .regex(namePattern, 'Only letters are allowed.'),
      description: z.string().trim().max(240, 'Use 240 characters or fewer.'),
      address: z.string().trim().max(240, 'Use 240 characters or fewer.'),
      contactName: z
        .string()
        .trim()
        .max(100, 'Use 100 characters or fewer.')
        .regex(namePattern, 'Only letters are allowed.'),
      contactEmail: z
        .string()
        .trim()
        .max(160, 'Use 160 characters or fewer.')
        .refine(
          (value) =>
            value === '' || z.string().email().safeParse(value).success,
          'Enter a valid email address.',
        )
        .transform((value) => value.toLowerCase()),
      contactPhone: z
        .string()
        .trim()
        .max(30, 'Use 30 characters or fewer.')
        .refine(
          (value) =>
            value === '' || (phonePattern.test(value) && /\d/.test(value)),
          'Enter a valid phone number.',
        ),
      isActive: z.boolean(),
    })
    .superRefine((data, context) => {
      const codeAlreadyExists = builders.some(
        (item) =>
          item.id !== currentBuilderId &&
          item.code.trim().toUpperCase() === data.code,
      )

      if (codeAlreadyExists) {
        context.addIssue({
          code: 'custom',
          path: ['code'],
          message: 'This builder code already exists.',
        })
      }
    })
}
