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

const NOT_APPLICABLE = /^n\/?a$/i

/** Whether a typed Option price is NA (also "N/A"), in any case. */
export function isNotApplicablePrice(value) {
  return NOT_APPLICABLE.test(String(value ?? '').trim())
}

// An Option price is a number, which can be negative (a credit subtracted when the
// Option is billed), or NA: it stays on the Lot but adds and subtracts nothing.
export const optionPriceSchema = z
  .object({
    amount: z
      .string()
      .trim()
      .min(1, 'Enter a price, or NA.')
      .refine(
        (value) => isNotApplicablePrice(value) || /^-?\d+(?:\.\d{1,2})?$/.test(value),
        'Enter a valid amount with up to 2 decimal places, or NA.',
      )
      .refine(
        (value) => isNotApplicablePrice(value) || Math.abs(Number(value)) <= 999999999999.99,
        'Enter a smaller amount.',
      ),
  })
  // `+ 0` turns a typed "-0" into 0.
  .transform(({ amount }) => (
    isNotApplicablePrice(amount)
      ? { amount: 0, notApplicable: true }
      : { amount: Number(amount) + 0, notApplicable: false }
  ))

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
