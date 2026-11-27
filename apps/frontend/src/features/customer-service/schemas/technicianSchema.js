import { z } from 'zod'
import { normalizePhoneNumber } from '../../../utils/phoneNumbers.js'
import { coordinatesSchema } from './persistedCustomerServiceSchema.js'

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a valid time.')

export const technicianSchema = z.object({
  name: z.string().trim().min(1, 'Enter the technician’s name.').max(100),
  email: z.string().trim().max(160)
    .refine((value) => value === '' || z.string().email().safeParse(value).success,
      'Enter a valid email address.')
    .transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(30).default(''),
  phoneCountry: z.enum(['US', 'MX']).default('US'),
  workdayStartsAt: timeSchema,
  workdayEndsAt: timeSchema,
}).superRefine((value, context) => {
  if (value.phone && !normalizePhoneNumber(value.phone, value.phoneCountry)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phone'],
      message: 'Enter a 10-digit U.S. or Mexico phone number.',
    })
  }
  if (value.workdayEndsAt <= value.workdayStartsAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workdayEndsAt'],
      message: 'End time must be after start time.',
    })
  }
}).transform(({ phoneCountry, ...value }) => ({
  ...value,
  phone: normalizePhoneNumber(value.phone, phoneCountry),
}))

export const schedulingSettingsSchema = z.object({
  companyAddress: z.string().trim().min(1, 'Enter the dispatch address.').max(240),
  coordinates: coordinatesSchema,
  workdayStartsAt: timeSchema,
  workdayEndsAt: timeSchema,
  timeZone: z.string().trim().min(1, 'Enter the scheduling time zone.').max(80),
  defaultDurationMinutes: z.coerce.number().int().min(15).max(720),
  distanceGreenMaxMiles: z.coerce.number().positive().max(999),
  distanceYellowMaxMiles: z.coerce.number().positive().max(999),
  distanceOrangeMaxMiles: z.coerce.number().positive().max(999),
  requiresDispatcherApproval: z.boolean(),
}).superRefine((value, context) => {
  if (value.workdayEndsAt <= value.workdayStartsAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workdayEndsAt'],
      message: 'End time must be after start time.',
    })
  }
  if (value.distanceYellowMaxMiles <= value.distanceGreenMaxMiles) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['distanceYellowMaxMiles'],
      message: 'The second distance band must be greater than the first.',
    })
  }
  if (value.distanceOrangeMaxMiles <= value.distanceYellowMaxMiles) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['distanceOrangeMaxMiles'],
      message: 'The third distance band must be greater than the second.',
    })
  }
}).transform(({ coordinates, ...value }) => ({ ...value, ...coordinates }))
