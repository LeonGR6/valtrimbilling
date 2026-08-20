import { z } from 'zod'

export const personTypeSchema = z.enum([
  'JOBSITE_SUPERINTENDENT',
  'SUPERVISOR',
  'AP_CONTACT',
])

const namePattern = /^[\p{L}\p{M}\s.'-]+$/u
const phonePattern = /^[\d\s()+.-]*$/

const optionalPhone = z
  .string()
  .trim()
  .max(30, 'Use 30 characters or fewer.')
  .refine(
    (value) => value === '' || (phonePattern.test(value) && /\d/.test(value)),
    'Enter a valid phone number.',
  )

export const personSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Enter the person’s name.')
      .max(100, 'Use 100 characters or fewer.')
      .regex(namePattern, 'Enter a valid name.'),
    phone: optionalPhone,
    officePhone: optionalPhone,
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
  })
  .superRefine((person, context) => {
    if (person.types.includes('SUPERVISOR') && !person.territory) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['territory'],
        message: 'Enter the supervisor’s territory.',
      })
    }
  })
  .transform((person) => ({
    ...person,
    territory: person.types.includes('SUPERVISOR') ? person.territory : '',
  }))
