import { z } from 'zod'
import { normalizePhoneNumber } from '../../../utils/phoneNumbers.js'

const namePattern = /^[\p{L}\p{M}\s.'-]+$/u

function parseIsoDate(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function calculateBusinessDueDate(startDate, businessDays = 5) {
  const date = parseIsoDate(startDate)
  let counted = 0

  while (counted < businessDays) {
    const day = date.getDay()
    if (day >= 1 && day <= 5) counted += 1
    if (counted < businessDays) date.setDate(date.getDate() + 1)
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const availabilitySchema = z.object({
  availableFrom: z.string().min(1, 'Enter the beginning of this window.'),
  availableUntil: z.string().min(1, 'Enter the end of this window.'),
  notes: z.string().trim().max(300, 'Use 300 characters or fewer.'),
})

const requiredCoordinate = (label, minimum, maximum) => z.preprocess(
  (value) => value === '' || value === null ? undefined : Number(value),
  z.number({
    required_error: `Enter the ${label}.`,
    invalid_type_error: `Enter a valid ${label}.`,
  })
    .min(minimum, `${label[0].toUpperCase()}${label.slice(1)} must be at least ${minimum}.`)
    .max(maximum, `${label[0].toUpperCase()}${label.slice(1)} must be at most ${maximum}.`),
)

export function createPersistedCustomerServiceSchema(
  businessDaysToComplete = 5,
  { startDate, dueDate } = {},
) {
  return z
    .object({
      reportedAt: z.string().min(1, 'Enter the reported date.'),
      lotNumber: z
        .string()
        .trim()
        .min(1, 'Enter the lot number.')
        .max(40, 'Use 40 characters or fewer.'),
      street: z
        .string()
        .trim()
        .min(1, 'Enter the property address.')
        .max(240, 'Use 240 characters or fewer.'),
      city: z.string().trim().max(80, 'Use 80 characters or fewer.'),
      state: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/, 'Use the two-letter state code.')
        .transform((value) => value.toUpperCase()),
      postalCode: z.string().trim().max(10, 'Use 10 characters or fewer.'),
      plan: z.string().trim().max(100, 'Use 100 characters or fewer.'),
      latitude: requiredCoordinate('latitude', -90, 90),
      longitude: requiredCoordinate('longitude', -180, 180),
      contactName: z
        .string()
        .trim()
        .min(1, 'Enter the customer name.')
        .max(100, 'Use 100 characters or fewer.')
        .regex(namePattern, 'Enter a valid customer name.'),
      contactPhone: z.string().trim().min(1, 'Enter the customer phone.'),
      contactPhoneCountry: z.enum(['US', 'MX']).default('US'),
      contactEmail: z
        .string()
        .trim()
        .min(1, 'Enter the customer email.')
        .email('Enter a valid email address.')
        .max(160, 'Use 160 characters or fewer.')
        .transform((value) => value.toLowerCase()),
      type: z.enum(['WARRANTY', 'PUNCH_LIST', 'SERVICE_CALL', 'COMPLAINT']),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
      issue: z
        .string()
        .trim()
        .min(1, 'Describe what needs attention.')
        .max(2000, 'Use 2,000 characters or fewer.'),
      workType: z.enum(['HW', 'WS', 'HW_WS']),
      estimatedDurationMinutes: z.coerce
        .number()
        .int('Use complete minutes.')
        .min(15, 'The minimum duration is 15 minutes.')
        .max(720, 'The maximum duration is 720 minutes.'),
      internalNotes: z.string().trim().max(2000, 'Use 2,000 characters or fewer.'),
      customerAvailabilityNotes: z
        .string()
        .trim()
        .max(1000, 'Use 1,000 characters or fewer.'),
      availability: z
        .array(availabilitySchema)
        .max(5, 'Use five availability windows or fewer.'),
    })
    .superRefine((data, context) => {
      const normalizedPhone = normalizePhoneNumber(
        data.contactPhone,
        data.contactPhoneCountry,
      )
      if (!normalizedPhone) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contactPhone'],
          message: 'Enter a 10-digit U.S. or Mexico phone number.',
        })
      }

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (parseIsoDate(data.reportedAt) > today) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reportedAt'],
          message: 'The reported date cannot be in the future.',
        })
      }

      const windowStart = startDate ?? data.reportedAt
      const dueOn = dueDate ?? calculateBusinessDueDate(
        windowStart,
        businessDaysToComplete,
      )

      data.availability.forEach((window, index) => {
        if (
          window.availableFrom
          && window.availableUntil
          && window.availableUntil <= window.availableFrom
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['availability', index, 'availableUntil'],
            message: 'The end must be after the beginning.',
          })
        }

        for (const [field, value] of [
          ['availableFrom', window.availableFrom],
          ['availableUntil', window.availableUntil],
        ]) {
          const date = value.slice(0, 10)
          if (value && (date < windowStart || date > dueOn)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['availability', index, field],
              message: `Use a date from ${windowStart} through ${dueOn}.`,
            })
          }
        }
      })
    })
    .transform((data) => {
      const { contactPhoneCountry, ...request } = data
      return {
        ...request,
        contactPhone: normalizePhoneNumber(
          data.contactPhone,
          contactPhoneCountry,
        ),
      }
    })
}
