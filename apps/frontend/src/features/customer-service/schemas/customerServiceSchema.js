import { z } from 'zod'

const namePattern = /^[\p{L}\p{M}\s.'-]+$/u
const phonePattern = /^[\d\s()+.-]*$/

// A visit only carries a date, a window and a technician once it exists, so
// those fields are validated against the appointment state instead of being
// required outright.
const VISIT_STATES = ['SCHEDULED', 'COMPLETED']

export const requestTagSchema = z.enum([
  '',
  'NEW',
  'FOLLOW_UP',
  'PARTS_NEEDED',
  'COMPLETED',
  'OVERDUE',
])

export const requestStatusSchema = z.enum([
  'NEW',
  'CONTACT_NEEDED',
  'CONFIRMED',
  'EN_ROUTE',
  'AWAITING_PARTS',
  'COMPLETED',
  'OVERDUE',
  'CLOSED',
])

export const appointmentStateSchema = z.enum([
  'NOT_SCHEDULED',
  'SCHEDULED',
  'COMPLETED',
  'OVERDUE',
])

export function createServiceRequestSchema(requests, currentRequestId) {
  return z
    .object({
      requestNumber: z
        .string()
        .trim()
        .min(1, 'Enter a request number.')
        .max(30, 'Use 30 characters or fewer.')
        .transform((value) => value.toUpperCase()),
      tag: requestTagSchema,
      reportedAt: z.string().min(1, 'Enter the date it was reported.'),
      // References into features/users and features/people, so a request
      // points at a record instead of repeating a name as loose text.
      createdById: z
        .number({ invalid_type_error: 'Select who logged the request.' })
        .int()
        .positive('Select who logged the request.'),
      builder: z.string().min(1, 'Select a builder.'),
      community: z
        .string()
        .trim()
        .min(1, 'Enter the community.')
        .max(100, 'Use 100 characters or fewer.'),
      lotNumber: z
        .string()
        .trim()
        .min(1, 'Enter the lot.')
        .max(20, 'Use 20 characters or fewer.')
        .transform((value) => value.toUpperCase()),
      // The crew is dispatched to this address, so it has to be complete.
      street: z
        .string()
        .trim()
        .min(1, 'Enter the street address.')
        .max(120, 'Use 120 characters or fewer.'),
      city: z
        .string()
        .trim()
        .min(1, 'Enter the city.')
        .max(80, 'Use 80 characters or fewer.'),
      state: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/, 'Use the two-letter state code.')
        .transform((value) => value.toUpperCase()),
      postalCode: z
        .string()
        .trim()
        .regex(/^\d{5}$/, 'Enter a five-digit ZIP code.'),
      plan: z.string().trim().max(40, 'Use 40 characters or fewer.'),
      contactName: z
        .string()
        .trim()
        .min(1, 'Enter the homeowner’s name.')
        .max(100, 'Use 100 characters or fewer.')
        .regex(namePattern, 'Enter a valid name.'),
      contactPhone: z
        .string()
        .trim()
        .min(1, 'Enter a phone number.')
        .max(30, 'Use 30 characters or fewer.')
        .refine(
          (value) => phonePattern.test(value) && /\d/.test(value),
          'Enter a valid phone number.',
        ),
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
      type: z.enum(['WARRANTY', 'PUNCH_LIST', 'SERVICE_CALL', 'COMPLAINT']),
      issue: z
        .string()
        .trim()
        .min(1, 'Describe what needs attention.')
        .max(200, 'Use 200 characters or fewer.'),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
      status: requestStatusSchema,
      statusNote: z.string().trim().max(60, 'Use 60 characters or fewer.'),
      appointmentState: appointmentStateSchema,
      appointmentDate: z.string(),
      appointmentStart: z.string(),
      appointmentEnd: z.string(),
      technicianId: z.union([z.number().int().positive(), z.literal('')]),
      notes: z.string().trim().max(500, 'Use 500 characters or fewer.'),
    })
    .superRefine((data, context) => {
      // Two requests sharing a number would make the builder’s follow-up
      // ambiguous, since that is the reference they quote back.
      const numberAlreadyExists = requests.some(
        (item) =>
          item.id !== currentRequestId &&
          item.requestNumber.trim().toUpperCase() === data.requestNumber,
      )

      if (numberAlreadyExists) {
        context.addIssue({
          code: 'custom',
          path: ['requestNumber'],
          message: 'This request number already exists.',
        })
      }

      // An overdue visit is one that was promised for a date and missed, so it
      // still needs the date it was due.
      const needsDate =
        VISIT_STATES.includes(data.appointmentState) ||
        data.appointmentState === 'OVERDUE'

      if (needsDate && !data.appointmentDate) {
        context.addIssue({
          code: 'custom',
          path: ['appointmentDate'],
          message:
            data.appointmentState === 'OVERDUE'
              ? 'Enter the date the visit was due.'
              : 'Enter the appointment date.',
        })
      }

      if (VISIT_STATES.includes(data.appointmentState)) {
        if (!data.appointmentStart) {
          context.addIssue({
            code: 'custom',
            path: ['appointmentStart'],
            message: 'Enter the arrival window.',
          })
        }

        if (!data.appointmentEnd) {
          context.addIssue({
            code: 'custom',
            path: ['appointmentEnd'],
            message: 'Enter the end of the arrival window.',
          })
        }

        // Zero-padded 24-hour strings compare correctly as text.
        if (
          data.appointmentStart &&
          data.appointmentEnd &&
          data.appointmentEnd <= data.appointmentStart
        ) {
          context.addIssue({
            code: 'custom',
            path: ['appointmentEnd'],
            message: 'The window has to end after it starts.',
          })
        }

        if (!data.technicianId) {
          context.addIssue({
            code: 'custom',
            path: ['technicianId'],
            message: 'Assign a technician.',
          })
        }
      }
    })
}
