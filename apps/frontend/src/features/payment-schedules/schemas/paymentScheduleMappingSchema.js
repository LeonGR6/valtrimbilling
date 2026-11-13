import { z } from 'zod'

// Client-side twin of private.validate_payment_schedule_mapping(). The database
// is the authority; this gives the reviewer the same answers before saving.
// Messages match the database wording.

const MAX_CELLS = 5000
const MAX_TEXT = 40
const MAX_AMOUNT = 9999999999.99
const EDGE_TOLERANCE = 1.000001

const finite = z.number().finite()

// The database compares the exact number it receives with that number rounded
// to cents, so float noise such as 0.30000000000000004 is rejected there too.
function hasTwoDecimalsAtMost(value) {
  return Number(value.toFixed(2)) === value
}

const text = (message) => z
  .string()
  .min(1, message)
  .max(MAX_TEXT, message)
  .refine((value) => value.trim() === value, message)

function createRectSchema(name = 'cell') {
  return z
    .object({
      x: finite.min(0).max(1),
      y: finite.min(0).max(1),
      w: finite.gt(0),
      h: finite.gt(0),
    })
    .strict()
    .superRefine((rect, context) => {
      if (rect.x + rect.w > EDGE_TOLERANCE || rect.y + rect.h > EDGE_TOLERANCE) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `The ${name} rectangle must stay inside the page`,
        })
      }
    })
}

function createSummaryRowSchema(pageCount) {
  const target = z
    .object({
      draw: finite.refine(
        (draw) => Number.isInteger(draw) && draw >= 1 && draw <= 5,
        { message: 'Each summary box needs a draw number from 1 to 5, used once' },
      ),
      page: finite.refine(
        (page) => Number.isInteger(page) && page >= 1 && page <= pageCount,
        { message: 'The summary box page is outside the document' },
      ),
      rect: createRectSchema('summary box'),
    })
    .strict()

  return z
    .array(target)
    .min(1, 'Each summary row needs between 1 and 5 boxes, one per draw')
    .max(5, 'Each summary row needs between 1 and 5 boxes, one per draw')
    .superRefine((boxes, context) => {
      if (new Set(boxes.map((box) => box.draw)).size !== boxes.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Each summary box needs a draw number from 1 to 5, used once',
        })
      }
    })
}

export function createPaymentScheduleMappingSchema(pageCount) {
  const cell = z
    .object({
      phase: text('A cell Phase must be empty or 1 to 40 characters').nullable(),
      lot: text('Each cell needs a Lot of 1 to 40 characters'),
      draw: finite.refine(
        (draw) => Number.isInteger(draw) && draw >= 1 && draw <= 5,
        { message: 'Each cell needs a draw number from 1 to 5' },
      ),
      amount: finite.refine(
        (amount) => amount >= 0 && amount <= MAX_AMOUNT && hasTwoDecimalsAtMost(amount),
        { message: 'Each cell needs an amount with at most two decimals' },
      ),
      page: finite.refine(
        (page) => Number.isInteger(page) && page >= 1 && page <= pageCount,
        { message: 'The cell page is outside the document' },
      ),
      rect: createRectSchema(),
    })
    .strict()

  return z
    .object({
      version: z.literal(1),
      layout: z.enum(['matrix', 'line_items']),
      cells: z
        .array(cell)
        .min(1, `Map between 1 and ${MAX_CELLS} cells`)
        .max(MAX_CELLS, `Map between 1 and ${MAX_CELLS} cells`),
      summaryRows: z
        .object({
          previouslyInvoiced: createSummaryRowSchema(pageCount).optional(),
          thisRequest: createSummaryRowSchema(pageCount).optional(),
        })
        .strict()
        .refine(
          (rows) => rows.previouslyInvoiced !== undefined || rows.thisRequest !== undefined,
          'The summary rows need a previouslyInvoiced or a thisRequest list',
        )
        .optional(),
    })
    .strict()
    .superRefine((mapping, context) => {
      if (mapping.summaryRows && mapping.layout !== 'matrix') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The summary rows only apply to the matrix layout',
        })
      }

      const keys = new Set(
        mapping.cells.map((cell) => `${cell.phase ?? ''}|${cell.lot}|${cell.draw}`),
      )
      if (keys.size !== mapping.cells.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Each Phase, Lot and draw can appear only once',
        })
      }
    })
}

/** { success, errors: string[] } with the first message per problem. */
export function validatePaymentScheduleMapping(mapping, pageCount) {
  const result = createPaymentScheduleMappingSchema(pageCount).safeParse(mapping)
  if (result.success) return { success: true, errors: [] }

  const errors = [...new Set(result.error.issues.map((issue) => issue.message))]
  return { success: false, errors }
}
