import { z } from 'zod'
import { isScopedRole } from '../data/users.js'

// One role per user. Access levels are mutually exclusive, so this is an enum
// rather than an array — see features/people for the multi-select counterpart.
export const userRoleSchema = z.enum([
  'ADMIN',
  'ACCOUNTING',
  'PROJECT_MANAGEMENT',
  'SCHEDULING',
  'FIELD',
  'READ_ONLY',
])

const namePattern = /^[\p{L}\p{M}\s.'-]+$/u
const phonePattern = /^[\d\s()+.-]*$/

export function createUserSchema(users, currentUserId) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Enter the user’s name.')
        .max(100, 'Use 100 characters or fewer.')
        .regex(namePattern, 'Enter a valid name.'),
      email: z
        .string()
        .trim()
        .min(1, 'Enter an email address.')
        .max(160, 'Use 160 characters or fewer.')
        .email('Enter a valid email address.')
        .transform((value) => value.toLowerCase()),
      phone: z
        .string()
        .trim()
        .max(30, 'Use 30 characters or fewer.')
        .refine(
          (value) =>
            value === '' || (phonePattern.test(value) && /\d/.test(value)),
          'Enter a valid phone number.',
        ),
      role: userRoleSchema,
      allProjects: z.boolean(),
      projectAccess: z.array(z.string()),
      isActive: z.boolean(),
    })
    .superRefine((data, context) => {
      // Scoped roles limited to a list need at least one project, otherwise
      // they would be locked out of everything.
      if (
        isScopedRole(data.role) &&
        !data.allProjects &&
        data.projectAccess.length === 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['projectAccess'],
          message: 'Select at least one project for this role.',
        })
      }

      // Email is the sign-in identity, so it has to be unique. Once Supabase
      // Auth backs this screen, the constraint moves to the database.
      const emailAlreadyExists = users.some(
        (item) =>
          item.id !== currentUserId &&
          item.email.trim().toLowerCase() === data.email,
      )

      if (emailAlreadyExists) {
        context.addIssue({
          code: 'custom',
          path: ['email'],
          message: 'This email address is already in use.',
        })
      }
    })
}
