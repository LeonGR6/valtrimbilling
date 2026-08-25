import { z } from 'zod'

// Builder-side types moved to features/builder-contacts. This screen only
// holds Valtrim's own field staff.
export const personTypeSchema = z.enum(['SUPERVISOR'])

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

export const personSchema = z.object({
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
})
