import { z } from 'zod'
import { normalizePhoneNumber } from '../../../utils/phoneNumbers.js'

// Builder-side types moved to features/builder-contacts. This screen only
// holds Valtrim's own field staff.
export const personTypeSchema = z.enum(['SUPERVISOR'])

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

export const personSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Enter the person’s name.')
      .max(100, 'Use 100 characters or fewer.')
      .regex(namePattern, 'Enter a valid name.'),
    phone: optionalPhone,
    phoneCountry,
    officePhone: optionalPhone,
    officePhoneCountry: phoneCountry,
    email: z
      .string()
      .trim()
      .min(1, 'Enter an email address.')
      .max(160, 'Use 160 characters or fewer.')
      .email('Enter a valid email address.')
      .transform((value) => value.toLowerCase()),
    types: z
      .array(personTypeSchema)
      .min(1, 'Select at least one person type.'),
    territory: z
      .string()
      .trim()
      .max(80, 'Use 80 characters or fewer.')
      .default(''),
    isActive: z.boolean().default(true),
  })
  .superRefine((person, context) => {
    if (person.phone && !normalizePhoneNumber(person.phone, person.phoneCountry)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: 'Enter a 10-digit U.S. or Mexico phone number.',
      })
    }

    if (person.officePhone && !normalizePhoneNumber(person.officePhone, person.officePhoneCountry)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['officePhone'],
        message: 'Enter a 10-digit U.S. or Mexico phone number.',
      })
    }

    if (person.types.includes('SUPERVISOR') && !person.territory) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['territory'],
        message: 'Enter the supervisor’s territory.',
      })
    }
  })
  .transform((person) => {
    const { phoneCountry: mobileCountry, officePhoneCountry, ...savedPerson } = person

    return {
      ...savedPerson,
      phone: normalizePhoneNumber(person.phone, mobileCountry),
      officePhone: normalizePhoneNumber(person.officePhone, officePhoneCountry),
      territory: person.types.includes('SUPERVISOR') ? person.territory : '',
    }
  })
