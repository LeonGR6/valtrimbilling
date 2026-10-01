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

export function createHardwarePriceSchema(planPrice) {
  return priceSchema.superRefine((_value, context) => {
    if (!Number.isFinite(planPrice)) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Set the Plan price before the Hardware price.',
      })
    }
  })
}
