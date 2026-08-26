import { z } from 'zod'

export const priceSchema = z
  .object({
    amount: z
      .string()
      .trim()
      .min(1, 'Enter a price.')
      .refine(
        (value) => /^\d+(?:\.\d{1,2})?$/.test(value),
        'Enter a valid amount with up to 2 decimal places.',
      ),
  })
  .transform(({ amount }) => ({ amount: Number(amount) }))

export function createHardwarePriceSchema(basePlanPrice) {
  return priceSchema.superRefine(({ amount }, context) => {
    if (!Number.isFinite(basePlanPrice)) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Set the base plan price before the hardware price.',
      })
      return
    }

    if (amount > basePlanPrice) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Hardware price cannot exceed the base plan price.',
      })
    }
  })
}
