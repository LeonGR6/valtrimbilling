import { z } from 'zod'
import { emailField } from '../../common/schemas/fields'

export const forgotPasswordSchema = z.object({
  email: emailField,
})
