import { z } from 'zod'
import { passwordField } from '../../common/schemas/fields'

export const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords don't match",
    path: ['confirm'],
  })
