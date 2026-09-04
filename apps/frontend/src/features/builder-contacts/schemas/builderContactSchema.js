import { z } from 'zod'
import { normalizePhoneNumber } from '../../../utils/phoneNumbers.js'

export const contactTypeSchema = z.enum(['JOBSITE_SUPERINTENDENT', 'AP_CONTACT'])

const namePattern = /^[\p{L}\p{M}\s.'-]+$/u
const optionalPhone = z
  .string()
  .trim()
  .max(30, 'Use 30 characters or fewer.')
  .refine(
    (value) => value === '' || (/^[\d\s()+.-]+$/.test(value) && /\d/.test(value)),
    'Enter a valid phone number.',
  )

const phoneCountry = z.enum(['US', 'MX']).default('US')

export function createBuilderContactSchema(contacts, currentContactId) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Enter the contact’s name.')
        .max(100, 'Use 100 characters or fewer.')
        .regex(namePattern, 'Enter a valid name.'),
      type: contactTypeSchema,
      builder: z.string().min(1, 'Select a builder.'),
      email: z
        .string()
        .trim()
        .min(1, 'Enter an email address.')
        .max(160, 'Use 160 characters or fewer.')
        .email('Enter a valid email address.')
        .transform((value) => value.toLowerCase()),
      phone: optionalPhone,
      phoneCountry,
      officePhone: optionalPhone,
      officePhoneCountry: phoneCountry,
      notes: z.string().trim().max(300, 'Use 300 characters or fewer.'),
    })
    .superRefine((data, context) => {
      if (data.phone && !normalizePhoneNumber(data.phone, data.phoneCountry)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['phone'],
          message: 'Enter a 10-digit U.S. or Mexico phone number.',
        })
      }

      if (data.officePhone && !normalizePhoneNumber(data.officePhone, data.officePhoneCountry)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['officePhone'],
          message: 'Enter a 10-digit U.S. or Mexico phone number.',
        })
      }

      // The same address twice would send the billing package to one person
      // and the follow-up to a duplicate record.
      const emailAlreadyExists = contacts.some(
        (item) =>
          item.id !== currentContactId &&
          item.email.trim().toLowerCase() === data.email,
      )

      if (emailAlreadyExists) {
        context.addIssue({
          code: 'custom',
          path: ['email'],
          message: 'This email address is already used by another contact.',
        })
      }
    })
    .transform((data) => {
      const { phoneCountry: mobileCountry, officePhoneCountry, ...savedContact } = data

      return {
        ...savedContact,
        phone: normalizePhoneNumber(data.phone, mobileCountry),
        officePhone: normalizePhoneNumber(data.officePhone, officePhoneCountry),
      }
    })
}
