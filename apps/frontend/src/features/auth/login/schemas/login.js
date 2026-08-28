import { z } from 'zod'
import { emailField } from '../../common/schemas/fields'

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required'),
})
