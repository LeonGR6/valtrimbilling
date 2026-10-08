// Pure helpers for Release templates: the variable catalog, the persisted
// record model, coordinate normalization and the mapping the database stores.
// Nothing here touches the network or React.

export const RELEASE_TYPES = [
  {
    value: 'ConditionalWaiverAndReleaseOnProgressPayment',
    label: 'Conditional Waiver and Release on Progress Payment',
    shortLabel: 'Conditional · Progress',
  },
  {
    value: 'ConditionalWaiverAndReleaseOnFinalPayment',
    label: 'Conditional Waiver and Release on Final Payment',
    shortLabel: 'Conditional · Final',
  },
  {
    value: 'UnconditionalWaiverAndReleaseOnProgressPayment',
    label: 'Unconditional Waiver and Release on Progress Payment',
    shortLabel: 'Unconditional · Progress',
  },
  {
    value: 'UnconditionalWaiverAndReleaseOnFinalPayment',
    label: 'Unconditional Waiver and Release on Final Payment',
    shortLabel: 'Unconditional · Final',
  },
]

const DATE_FORMATS = [
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  { value: 'MMMM D, YYYY', label: 'Month D, YYYY' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
]

// The forms print the dollar sign themselves ("Amount of Check: $"), so the
// number alone is the usual choice and the default.
const AMOUNT_FORMATS = [
  { value: 'plain', label: '1,250.00' },
  { value: 'currency', label: '$1,250.00' },
]

// Must match private.release_template_variables() and the format rule in
// private.validate_release_template_mapping() (tests read the migrations).
export const RELEASE_VARIABLES = [
  {
    key: 'through_date',
    kind: 'date',
    label: 'Through Date',
    formats: DATE_FORMATS,
    defaultFormat: 'MM/DD/YYYY',
  },
  {
    key: 'check_amount',
    kind: 'amount',
    label: 'Amount of Check',
    formats: AMOUNT_FORMATS,
    defaultFormat: 'plain',
  },
  {
    key: 'signature_date',
    kind: 'date',
    label: 'Date of Signature',
    formats: DATE_FORMATS,
    defaultFormat: 'MM/DD/YYYY',
  },
  // The two blanks of the "Exceptions" part of the Conditional Progress form.
  {
    key: 'waiver_release_dates',
    kind: 'date',
    label: 'Date(s) of Waiver and Release',
    formats: DATE_FORMATS,
    defaultFormat: 'MM/DD/YYYY',
  },
  {
    key: 'unpaid_progress_amount',
    kind: 'amount',
    label: 'Amount(s) of Unpaid Progress Payment(s)',
    formats: AMOUNT_FORMATS,
    defaultFormat: 'plain',
  },
]

export const DEFAULT_FONT_SIZE = 10
export const MIN_FONT_SIZE = 4
export const MAX_FONT_SIZE = 48
// Same threshold the analysis function uses to ask for a closer look.
export const REVIEW_CONFIDENCE_THRESHOLD = 0.75
export const ANALYZABLE_DOCUMENT_TYPE = 'RELEASE'

const COORDINATE_DECIMALS = 5
const DEFAULT_BOX = { x: 0.3, y: 0.4, w: 0.3, h: 0.025 }
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
]

export function getReleaseVariable(key) {
  return RELEASE_VARIABLES.find((variable) => variable.key === key) ?? null
}

export function getReleaseType(value) {
  return RELEASE_TYPES.find((type) => type.value === value) ?? null
}

export function releaseTypeLabel(value) {
  return getReleaseType(value)?.label ?? 'Not classified'
}

export function toReleaseTemplate(row) {
  const classification = row.classification ?? {}
  return {
    id: row.id,
    documentId: row.job_document_id,
    jobId: row.job_id,
    releaseType: row.release_type ?? null,
    classification: {
      method: classification.method ?? 'none',
      confidence: Number(classification.confidence ?? 0),
      evidence: classification.evidence ?? '',
      candidates: Array.isArray(classification.candidates)
        ? classification.candidates
        : [],
    },
    detectionMethod: row.detection_method ?? null,
    pageCount: row.page_count ?? 0,
    pageSizes: Array.isArray(row.page_sizes) ? row.page_sizes : [],
    suggestions: Array.isArray(row.detected_fields) ? row.detected_fields : [],
    mapping: row.mapping ?? null,
    status: row.status,
    error: row.error ?? null,
    confirmedAt: row.confirmed_at ?? null,
    analyzedAt: row.analyzed_at ?? null,
    updatedAt: row.updated_at,
  }
}

// --- Geometry ---------------------------------------------------------------

function round(value) {
  const factor = 10 ** COORDINATE_DECIMALS
  return Math.round(value * factor) / factor
}

/** Size of a page as it is displayed (a 90/270 rotation swaps the sides). */
export function displayPageSize(pageSize) {
  const rotated = pageSize.rotation === 90 || pageSize.rotation === 270
  return rotated
    ? { width: pageSize.height, height: pageSize.width }
    : { width: pageSize.width, height: pageSize.height }
}

/** Keeps a normalized rectangle inside the page without changing its size when possible. */
export function clampRect({ x, y, w, h }) {
  const width = Math.min(Math.max(w, 0.001), 1)
  const height = Math.min(Math.max(h, 0.001), 1)
  const left = Math.min(Math.max(x, 0), 1 - width)
  const top = Math.min(Math.max(y, 0), 1 - height)
  return { x: round(left), y: round(top), w: round(width), h: round(height) }
}

/** Normalized rectangle -> pixels inside a rendered page of `size` pixels. */
export function rectToPixels(rect, size) {
  return {
    x: rect.x * size.width,
    y: rect.y * size.height,
    width: rect.w * size.width,
    height: rect.h * size.height,
  }
}

/** Pixels inside a rendered page -> normalized rectangle (0-1, top-left origin). */
export function pixelsToRect(box, size) {
  return clampRect({
    x: box.x / size.width,
    y: box.y / size.height,
    w: box.width / size.width,
    h: box.height / size.height,
  })
}

// --- Placements -------------------------------------------------------------
//
// A placement is the editable form of one mapped field:
//   { variable, kind: 'rect', page, x, y, w, h, fontSize, format, cover }
//   { variable, kind: 'acroform', fieldName, fontSize, format, cover }
// The editor only creates rectangles; acroform placements can only come from a
// stored mapping and are carried through untouched.

export function bestSuggestion(template, variableKey) {
  return template.suggestions
    .filter((suggestion) => suggestion.variable === variableKey)
    .sort((left, right) => right.confidence - left.confidence)[0] ?? null
}

export function createPlacement(variableKey, { page = 1, rect = null } = {}) {
  const variable = getReleaseVariable(variableKey)
  if (!variable) throw new Error('Select a supported Release variable.')

  return {
    variable: variableKey,
    kind: 'rect',
    page,
    ...clampRect(rect ?? DEFAULT_BOX),
    fontSize: DEFAULT_FONT_SIZE,
    format: variable.defaultFormat,
    cover: false,
  }
}

/** Placement for a variable, starting from the suggestion when it has a rectangle. */
export function placementFromSuggestion(template, variableKey) {
  const suggestion = bestSuggestion(template, variableKey)
  if (suggestion?.rect && suggestion.state === 'blank') {
    return createPlacement(variableKey, {
      page: suggestion.rect.page,
      rect: suggestion.rect,
    })
  }
  return createPlacement(variableKey, { page: suggestion?.page ?? 1 })
}

export function placementsFromMapping(mapping) {
  return (mapping?.fields ?? []).map((field) => {
    const base = {
      variable: field.variable,
      fontSize: field.fontSize,
      format: field.format,
      cover: field.cover === true,
    }
    if (field.target.kind === 'acroform') {
      return { ...base, kind: 'acroform', fieldName: field.target.fieldName }
    }
    const { page, x, y, w, h } = field.target
    return { ...base, kind: 'rect', page, x, y, w, h }
  })
}

/**
 * What the reviewer starts from: the stored mapping when the template was
 * confirmed before, otherwise the best blank suggestion of each variable.
 */
export function initialPlacements(template) {
  if (template.mapping) return placementsFromMapping(template.mapping)

  return RELEASE_VARIABLES
    .filter(({ key }) => {
      const suggestion = bestSuggestion(template, key)
      return suggestion?.rect && suggestion.state === 'blank'
    })
    .map(({ key }) => placementFromSuggestion(template, key))
}

export function buildMapping(placements) {
  return {
    version: 1,
    fields: placements.map((placement) => {
      const field = {
        variable: placement.variable,
        target: placement.kind === 'acroform'
          ? { kind: 'acroform', fieldName: placement.fieldName }
          : {
              kind: 'rect',
              page: placement.page,
              x: placement.x,
              y: placement.y,
              w: placement.w,
              h: placement.h,
            },
        fontSize: Number(placement.fontSize),
        format: placement.format,
      }
      if (placement.cover) field.cover = true
      return field
    }),
  }
}

// --- Display ----------------------------------------------------------------

function pad(value) {
  return String(value).padStart(2, '0')
}

/** Example of how a value looks with a format, shown inside the placed box. */
export function sampleValue(variableKey, format, now = new Date()) {
  if (variableKey === 'check_amount' || variableKey === 'unpaid_progress_amount') {
    return format === 'plain' ? '1,250.00' : '$1,250.00'
  }

  const year = now.getFullYear()
  const month = now.getMonth()
  const day = now.getDate()
  switch (format) {
    case 'MMMM D, YYYY':
      return `${MONTHS[month]} ${day}, ${year}`
    case 'YYYY-MM-DD':
      return `${year}-${pad(month + 1)}-${pad(day)}`
    default:
      return `${pad(month + 1)}/${pad(day)}/${year}`
  }
}

export function describeClassification(template) {
  const { confidence, method, evidence } = template.classification
  const percent = `${Math.round(confidence * 100)}%`
  const methodLabel = {
    title_rules: 'form title',
    wide_rules: 'text on the first page',
    llm: 'AI tie-break',
    filename: 'file name',
    none: 'not recognised',
  }[method] ?? 'not recognised'

  return {
    percent,
    methodLabel,
    evidence,
    needsAttention: !template.releaseType
      || confidence < REVIEW_CONFIDENCE_THRESHOLD,
  }
}

/** What the reviewer is told about the best suggestion of a variable. */
export function describeSuggestion(suggestion) {
  if (!suggestion) {
    return 'Not found in this form. Leave it unplaced if the form does not have it.'
  }
  if (suggestion.state === 'filled') {
    return `Already filled in the document (page ${suggestion.page}). Place a box only if it must be replaced.`
  }
  if (!suggestion.rect) {
    return `Label found on page ${suggestion.page}. Place the box by hand.`
  }

  const sure = `${Math.round(suggestion.confidence * 100)}% sure`
  return suggestion.source === 'ocr'
    ? `Estimated from the scanned page (${sure}). Check that the box sits on the blank area.`
    : `Suggested from the form (${sure}). Adjust the box if needed.`
}

/** Short status for the document card. */
export function describeTemplateStatus(template) {
  if (!template) return null
  const type = getReleaseType(template.releaseType)

  switch (template.status) {
    case 'confirmed':
      return {
        color: 'success',
        label: `Template · ${type?.shortLabel ?? 'Confirmed'}`,
      }
    case 'needs_review':
      return { color: 'warning', label: 'Template needs review' }
    case 'analyzing':
      return { color: 'info', label: 'Analyzing…' }
    case 'failed':
      return { color: 'error', label: 'Analysis failed' }
    case 'superseded':
      return { color: 'default', label: 'Replaced by a newer template' }
    default:
      return null
  }
}
