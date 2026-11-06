import { z } from 'zod'
import { normalizePhoneNumber } from '../../../utils/phoneNumbers.js'

import { MAX_CONTACT_TYPE_LENGTH, cleanContactTypeName } from '../data/builderContacts.js'

// The type is free text: the fixed Jobsite Superintendent and AP Contact, or
// anything else the team types ("Coordinator").
export const contactTypeNameSchema = z
  .string()
  .transform(cleanContactTypeName)
  .pipe(
    z
      .string()
      .min(1, 'Enter the contact type.')
      .max(MAX_CONTACT_TYPE_LENGTH, `Use ${MAX_CONTACT_TYPE_LENGTH} characters or fewer.`)
      .regex(/^[\p{L}\p{N}\s&.'/-]+$/u, 'Use letters, numbers and common punctuation only.'),
  )

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

const contactNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter the contact’s name.')
  .max(100, 'Use 100 characters or fewer.')
  .regex(namePattern, 'Enter a valid name.')

const contactEmailSchema = z
  .string()
  .trim()
  .min(1, 'Enter an email address.')
  .max(160, 'Use 160 characters or fewer.')
  .email('Enter a valid email address.')
  .transform((value) => value.toLowerCase())

function addPhoneIssues(data, context) {
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
}

function normalizeContactPhones(data) {
  const { phoneCountry: mobileCountry, officePhoneCountry, ...savedContact } = data

  return {
    ...savedContact,
    phone: normalizePhoneNumber(data.phone, mobileCountry),
    officePhone: normalizePhoneNumber(data.officePhone, officePhoneCountry),
  }
}

// A contact added while the builder is created: the builder is the one being
// saved, so it has no builder of its own to pick.
export const builderExtraContactSchema = z
  .object({
    name: contactNameSchema,
    typeName: contactTypeNameSchema,
    email: contactEmailSchema,
    phone: optionalPhone,
    phoneCountry,
    officePhone: optionalPhone,
    officePhoneCountry: phoneCountry,
  })
  .superRefine(addPhoneIssues)
  .transform(normalizeContactPhones)

export function createBuilderContactSchema(contacts, currentContactId) {
  return z
    .object({
      name: contactNameSchema,
      typeName: contactTypeNameSchema,
      builderId: z.preprocess(
        (value) => Number(value),
        z.number().int().positive('Select a builder.'),
      ),
      email: contactEmailSchema,
      phone: optionalPhone,
      phoneCountry,
      officePhone: optionalPhone,
      officePhoneCountry: phoneCountry,
      notes: z.string().trim().max(300, 'Use 300 characters or fewer.'),
      isActive: z.boolean().default(true),
    })
    .superRefine((data, context) => {
      addPhoneIssues(data, context)

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
    .transform(normalizeContactPhones)
}
