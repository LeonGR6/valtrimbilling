import { z } from 'zod'
import { normalizePhoneNumber } from '../../../utils/phoneNumbers.js'

const namePattern = /^[\p{L}\s'-]*$/u
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
          (value) => value === '' || (/^[\d\s()+.-]+$/.test(value) && /\d/.test(value)),
          'Enter a valid phone number.',
        ),
      contactPhoneCountry: z.enum(['US', 'MX']).default('US'),
      isActive: z.boolean(),
    })
    .superRefine((data, context) => {
      if (data.contactPhone && !normalizePhoneNumber(data.contactPhone, data.contactPhoneCountry)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contactPhone'],
          message: 'Enter a 10-digit U.S. or Mexico phone number.',
        })
      }

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
    .transform((data) => {
      const { contactPhoneCountry, ...savedBuilder } = data
      return {
        ...savedBuilder,
        contactPhone: normalizePhoneNumber(data.contactPhone, contactPhoneCountry),
      }
    })
}
