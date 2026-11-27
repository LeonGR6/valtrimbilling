import { z } from 'zod'
import { RELEASE_VARIABLES } from '../services/releaseTemplateRecord.js'

// Client-side twin of private.validate_release_template_mapping(). The database
// is the authority; this gives the reviewer the same answers before saving.
// Messages match the database wording.

const MAX_FIELDS = 12
const EDGE_TOLERANCE = 1.000001

const variableKeys = RELEASE_VARIABLES.map(({ key }) => key)
const finite = z.number().finite()

function isFormatAllowed(variableKey, format) {
  return RELEASE_VARIABLES
    .find(({ key }) => key === variableKey)
    ?.formats.some((option) => option.value === format) ?? false
}

function createRectTarget(pageCount) {
  return z
    .object({
      kind: z.literal('rect'),
      page: finite
        .refine((page) => Number.isInteger(page) && page >= 1 && page <= pageCount, {
          message: 'The rectangle page is outside the document',
        }),
      x: finite.min(0).max(1),
      y: finite.min(0).max(1),
      w: finite.gt(0),
      h: finite.gt(0),
    })
    .strict()
}

const acroformTarget = z
  .object({
    kind: z.literal('acroform'),
    fieldName: z
      .string()
      .min(1, 'A form field target needs a field name')
      .max(200, 'A form field target needs a field name')
      .refine((name) => name.trim() === name, 'A form field target needs a field name'),
  })
  .strict()

export function createReleaseMappingSchema(pageCount) {
  const field = z
    .object({
      variable: z.enum(variableKeys, {
        errorMap: () => ({ message: 'Select a supported Release variable' }),
      }),
      target: z.discriminatedUnion('kind', [
        createRectTarget(pageCount),
        acroformTarget,
      ], {
        errorMap: () => ({ message: 'Select a rectangle or form field target' }),
      }),
      fontSize: finite.min(4, 'Enter a font size between 4 and 48')
        .max(48, 'Enter a font size between 4 and 48'),
      format: z.string(),
      cover: z.boolean().optional(),
    })
    .strict()
    .superRefine((value, context) => {
      // Zod's discriminated union needs plain objects, so the edge check that
      // spans several properties of a rectangle lives here.
      const { target } = value
      if (
        target.kind === 'rect'
        && (target.x + target.w > EDGE_TOLERANCE || target.y + target.h > EDGE_TOLERANCE)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['target'],
          message: 'The rectangle must stay inside the page',
        })
      }

      if (!isFormatAllowed(value.variable, value.format)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['format'],
          message: `Select a supported format for ${value.variable}`,
        })
      }
    })

  return z
    .object({
      version: z.literal(1),
      fields: z
        .array(field)
        .min(1, `Map between 1 and ${MAX_FIELDS} fields`)
        .max(MAX_FIELDS, `Map between 1 and ${MAX_FIELDS} fields`),
    })
    .strict()
}

/** { success, errors: string[] } with the first message per problem. */
export function validateReleaseMapping(mapping, pageCount) {
  const result = createReleaseMappingSchema(pageCount).safeParse(mapping)
  if (result.success) return { success: true, errors: [] }

  const errors = [...new Set(result.error.issues.map((issue) => issue.message))]
  return { success: false, errors }
}
