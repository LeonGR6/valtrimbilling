import { z } from 'zod'
import { normalizePhoneNumber } from '../../../utils/phoneNumbers.js'
import { builderExtraContactSchema } from '../../builder-contacts/schemas/builderContactSchema.js'

const namePattern = /^[\p{L}\s'-]*$/u
// A Builder's company name may carry numbers too ("G3 URBAN HOMES").
const builderNamePattern = /^[\p{L}\p{N}\s'-]*$/u

/**
 * @param builders the saved builders, to keep their codes unique
 * @param currentBuilderId the builder being edited, if any
 * @param contactEmails the emails of the contacts that already exist: a contact
 *   added with the builder cannot reuse one
 */
export function createBuilderSchema(builders, currentBuilderId, contactEmails = []) {
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
        .regex(builderNamePattern, 'Only letters and numbers are allowed.'),
      description: z.string().trim().max(240, 'Use 240 characters or fewer.'),
      addressLine1: z.string().trim().max(120, 'Use 120 characters or fewer.'),
      addressLine2: z.string().trim().max(120, 'Use 120 characters or fewer.'),
      city: z.string().trim().max(80, 'Use 80 characters or fewer.'),
      state: z
        .string()
        .trim()
        .refine((value) => value === '' || /^[A-Za-z]{2}$/.test(value), 'Use the two-letter state code.')
        .transform((value) => value.toUpperCase()),
      zipCode: z
        .string()
        .trim()
        .refine((value) => value === '' || /^\d{5}(-\d{4})?$/.test(value), 'Enter a five-digit ZIP code.'),
      country: z.enum(['US', 'MX']).default('US'),
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
      // Contacts of the builder besides the primary one, added while creating it.
      contacts: z.array(builderExtraContactSchema).default([]),
    })
    .superRefine((data, context) => {
      if (data.contactPhone && !normalizePhoneNumber(data.contactPhone, data.contactPhoneCountry)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contactPhone'],
          message: 'Enter a 10-digit U.S. or Mexico phone number.',
        })
      }

      const usedEmails = new Set(contactEmails.map((email) => email.trim().toLowerCase()))
      data.contacts.forEach((contact, index) => {
        if (usedEmails.has(contact.email)) {
          context.addIssue({
            code: 'custom',
            path: ['contacts', index, 'email'],
            message: 'This email address is already used by another contact.',
          })
        }
        usedEmails.add(contact.email)
      })

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
