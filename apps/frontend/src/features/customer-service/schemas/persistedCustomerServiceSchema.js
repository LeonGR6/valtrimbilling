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

export const coordinatesSchema = z
  .string()
  .trim()
  .min(1, 'Enter the coordinates.')
  .transform((value, context) => {
    const parts = value.split(',').map((part) => part.trim())
    if (parts.length !== 2 || parts.some((part) => part === '')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Paste latitude and longitude separated by a comma.',
      })
      return z.NEVER
    }

    const [latitude, longitude] = parts.map(Number)
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90
      || longitude < -180 || longitude > 180
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Latitude must be from -90 to 90 and longitude from -180 to 180.',
      })
      return z.NEVER
    }

    return { latitude, longitude }
  })

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
      city: z.string().trim().max(80, 'Use 80 characters or fewer.'),
      state: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/, 'Use the two-letter state code.')
        .transform((value) => value.toUpperCase()),
      postalCode: z.string().trim().max(10, 'Use 10 characters or fewer.'),
      plan: z.string().trim().max(100, 'Use 100 characters or fewer.'),
      coordinates: coordinatesSchema,
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
      customerUnavailableDates: z
        .array(z.object({
          date: z.string().min(1, 'Choose an unavailable day.'),
        }))
        .max(5, 'Use five unavailable days or fewer.'),
      customerNeedsContact: z.boolean(),
      customerAvailabilityNotes: z
        .string()
        .trim()
        .max(1000, 'Use 1,000 characters or fewer.'),
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

      const unavailableDates = new Set()
      data.customerUnavailableDates.forEach(({ date }, index) => {
        if (unavailableDates.has(date)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['customerUnavailableDates', index, 'date'],
            message: 'This unavailable day is already listed.',
          })
        }
        unavailableDates.add(date)

        const day = parseIsoDate(date).getDay()
        if (date && (date < windowStart || date > dueOn || day === 0 || day === 6)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['customerUnavailableDates', index, 'date'],
            message: `Choose a business day from ${windowStart} through ${dueOn}.`,
          })
        }
      })
    })
    .transform((data) => {
      const {
        contactPhoneCountry,
        coordinates,
        customerUnavailableDates,
        ...request
      } = data
      return {
        ...request,
        ...coordinates,
        customerUnavailableDates: customerUnavailableDates.map(({ date }) => date),
        contactPhone: normalizePhoneNumber(
          data.contactPhone,
          contactPhoneCountry,
        ),
      }
    })
}
