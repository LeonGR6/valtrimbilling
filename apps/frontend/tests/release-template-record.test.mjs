import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  bestSuggestion,
  buildMapping,
  clampRect,
  createPlacement,
  describeClassification,
  describeTemplateStatus,
  displayPageSize,
  initialPlacements,
  pixelsToRect,
  placementFromSuggestion,
  placementsFromMapping,
  RELEASE_TYPES,
  RELEASE_VARIABLES,
  rectToPixels,
  releaseTypeLabel,
  sampleValue,
  toReleaseTemplate,
} from '../src/features/release-templates/services/releaseTemplateRecord.js'

const row = {
  id: 'a4e0c4c2-6f1b-4b43-8f3e-0d4d4a7b2a11',
  job_document_id: '50aa9672-a0b2-4e21-99c6-776d159bf247',
  job_id: 1307,
  release_type: 'ConditionalWaiverAndReleaseOnProgressPayment',
  classification: {
    method: 'title_rules',
    confidence: 0.98,
    evidence: 'CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT',
    candidates: [{ releaseType: 'ConditionalWaiverAndReleaseOnProgressPayment', score: 1 }],
    needsTiebreak: false,
  },
  detection_method: 'acroform',
  page_count: 1,
  page_sizes: [{ page: 1, width: 612, height: 792, rotation: 0 }],
  detected_fields: [
    {
      variable: 'through_date',
      page: 1,
      label: 'Through Date:',
      confidence: 0.95,
      source: 'acroform',
      state: 'blank',
      rect: { page: 1, x: 0.228, y: 0.343, w: 0.311, h: 0.02 },
      fieldName: 'through date',
      reason: 'Through Date label next to a form field',
    },
    {
      variable: 'check_amount',
      page: 1,
      label: 'Amount of Check:',
      confidence: 0.6,
      source: 'text_layer',
      state: 'filled',
      rect: null,
      fieldName: null,
      reason: 'already filled',
    },
  ],
  mapping: null,
  status: 'needs_review',
  error: null,
  confirmed_at: null,
  analyzed_at: '2026-10-07T20:00:00Z',
  updated_at: '2026-10-07T20:00:01Z',
}

test('a stored row maps to the UI model', () => {
  const template = toReleaseTemplate(row)
  assert.equal(template.id, row.id)
  assert.equal(template.documentId, row.job_document_id)
  assert.equal(template.releaseType, 'ConditionalWaiverAndReleaseOnProgressPayment')
  assert.equal(template.classification.confidence, 0.98)
  assert.equal(template.pageCount, 1)
  assert.equal(template.suggestions.length, 2)
  assert.equal(template.mapping, null)
})

test('a row that was never analyzed still maps safely', () => {
  const template = toReleaseTemplate({
    id: 'x', job_document_id: 'y', job_id: 1, status: 'analyzing', updated_at: 'now',
    classification: {}, detected_fields: null, page_sizes: null,
  })
  assert.equal(template.releaseType, null)
  assert.deepEqual(template.suggestions, [])
  assert.deepEqual(template.pageSizes, [])
  assert.equal(template.classification.method, 'none')
})

test('rotated pages swap their displayed sides', () => {
  assert.deepEqual(displayPageSize({ width: 612, height: 792, rotation: 0 }), { width: 612, height: 792 })
  assert.deepEqual(displayPageSize({ width: 612, height: 792, rotation: 90 }), { width: 792, height: 612 })
  assert.deepEqual(displayPageSize({ width: 612, height: 792, rotation: 180 }), { width: 612, height: 792 })
  assert.deepEqual(displayPageSize({ width: 612, height: 792, rotation: 270 }), { width: 792, height: 612 })
})

test('normalized rectangles convert to pixels and back', () => {
  const size = { width: 800, height: 1035 }
  const rect = { x: 0.228, y: 0.343, w: 0.311, h: 0.02 }
  const pixels = rectToPixels(rect, size)
  assert.equal(pixels.x, 0.228 * 800)
  assert.equal(pixels.height, 0.02 * 1035)

  const back = pixelsToRect(pixels, size)
  for (const key of ['x', 'y', 'w', 'h']) {
    assert.ok(Math.abs(back[key] - rect[key]) < 1e-5, key)
  }
})

test('the same rectangle is the same at any rendered size', () => {
  const rect = { x: 0.25, y: 0.5, w: 0.2, h: 0.04 }
  const small = pixelsToRect(rectToPixels(rect, { width: 400, height: 518 }), { width: 400, height: 518 })
  const large = pixelsToRect(rectToPixels(rect, { width: 1200, height: 1553 }), { width: 1200, height: 1553 })
  assert.deepEqual(small, large)
})

test('dragging past an edge is clamped and keeps the box size', () => {
  const size = { width: 800, height: 1000 }
  const pastRight = pixelsToRect({ x: 790, y: 100, width: 200, height: 20 }, size)
  assert.ok(pastRight.x + pastRight.w <= 1)
  assert.equal(pastRight.w, 0.25)

  const negative = pixelsToRect({ x: -30, y: -5, width: 100, height: 20 }, size)
  assert.equal(negative.x, 0)
  assert.equal(negative.y, 0)
})

test('rectangles never exceed the page or collapse', () => {
  const huge = clampRect({ x: 0.5, y: 0.5, w: 4, h: 4 })
  assert.deepEqual(huge, { x: 0, y: 0, w: 1, h: 1 })
  const tiny = clampRect({ x: 0.2, y: 0.2, w: 0, h: -1 })
  assert.ok(tiny.w > 0 && tiny.h > 0)
})

test('a blank suggestion with a rectangle pre-places its variable', () => {
  const template = toReleaseTemplate(row)
  const placements = initialPlacements(template)
  assert.equal(placements.length, 1)
  assert.equal(placements[0].variable, 'through_date')
  assert.equal(placements[0].kind, 'rect')
  assert.equal(placements[0].page, 1)
  assert.equal(placements[0].format, 'MM/DD/YYYY')
  assert.equal(placements[0].x, 0.228)
})

test('an already filled label is not pre-placed but still points to its page', () => {
  const template = toReleaseTemplate(row)
  assert.equal(bestSuggestion(template, 'check_amount').state, 'filled')
  const placement = placementFromSuggestion(template, 'check_amount')
  assert.equal(placement.page, 1)
  assert.equal(placement.format, 'currency')
})

test('a variable without any suggestion starts from a default box on page 1', () => {
  const template = toReleaseTemplate(row)
  const placement = placementFromSuggestion(template, 'signature_date')
  assert.equal(placement.page, 1)
  assert.ok(placement.w > 0 && placement.x + placement.w <= 1)
})

test('a confirmed mapping is what the reviewer starts from', () => {
  const mapping = {
    version: 1,
    fields: [{
      variable: 'check_amount',
      target: { kind: 'rect', page: 1, x: 0.268, y: 0.544, w: 0.3, h: 0.02 },
      fontSize: 11,
      format: 'plain',
      cover: true,
    }],
  }
  const template = toReleaseTemplate({ ...row, status: 'confirmed', mapping })
  const placements = initialPlacements(template)
  assert.equal(placements.length, 1)
  assert.equal(placements[0].variable, 'check_amount')
  assert.equal(placements[0].fontSize, 11)
  assert.equal(placements[0].cover, true)
  assert.deepEqual(buildMapping(placements), mapping)
})

test('form field targets from a stored mapping are carried through untouched', () => {
  const mapping = {
    version: 1,
    fields: [{
      variable: 'signature_date',
      target: { kind: 'acroform', fieldName: 'date' },
      fontSize: 10,
      format: 'MM/DD/YYYY',
    }],
  }
  assert.deepEqual(buildMapping(placementsFromMapping(mapping)), mapping)
})

test('buildMapping produces the version 1 shape and omits cover unless set', () => {
  const placement = createPlacement('through_date', {
    page: 2,
    rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 },
  })
  const mapping = buildMapping([{ ...placement, fontSize: '12' }])
  assert.deepEqual(mapping, {
    version: 1,
    fields: [{
      variable: 'through_date',
      target: { kind: 'rect', page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.04 },
      fontSize: 12,
      format: 'MM/DD/YYYY',
    }],
  })
})

test('creating a placement for an unknown variable fails clearly', () => {
  assert.throws(() => createPlacement('invoice_number'), /supported Release variable/)
})

test('sample values show each format', () => {
  const day = new Date(2026, 8, 30)
  assert.equal(sampleValue('through_date', 'MM/DD/YYYY', day), '09/30/2026')
  assert.equal(sampleValue('through_date', 'MMMM D, YYYY', day), 'September 30, 2026')
  assert.equal(sampleValue('signature_date', 'YYYY-MM-DD', day), '2026-09-30')
  assert.equal(sampleValue('check_amount', 'currency'), '$1,250.00')
  assert.equal(sampleValue('check_amount', 'plain'), '1250.00')
})

test('classification is flagged when unsure or missing', () => {
  const sure = describeClassification(toReleaseTemplate(row))
  assert.equal(sure.percent, '98%')
  assert.equal(sure.methodLabel, 'form title')
  assert.equal(sure.needsAttention, false)

  const unsure = describeClassification(toReleaseTemplate({
    ...row,
    classification: { method: 'llm', confidence: 0.7, evidence: '' },
  }))
  assert.equal(unsure.needsAttention, true)

  const missing = describeClassification(toReleaseTemplate({ ...row, release_type: null }))
  assert.equal(missing.needsAttention, true)
})

test('the document card status follows the template status', () => {
  assert.equal(describeTemplateStatus(null), null)
  const status = (value, extra = {}) => describeTemplateStatus(toReleaseTemplate({ ...row, status: value, ...extra }))
  assert.equal(status('confirmed').color, 'success')
  assert.match(status('confirmed').label, /Conditional · Progress/)
  assert.equal(status('needs_review').color, 'warning')
  assert.equal(status('analyzing').color, 'info')
  assert.equal(status('failed').color, 'error')
  assert.equal(status('superseded').color, 'default')
})

test('release type labels cover the four types', () => {
  assert.equal(RELEASE_TYPES.length, 4)
  assert.equal(releaseTypeLabel('UnconditionalWaiverAndReleaseOnFinalPayment'), 'Unconditional Waiver and Release on Final Payment')
  assert.equal(releaseTypeLabel(null), 'Not classified')
})

// --- The client catalog must not drift from the database -------------------

const migrationsDirectory = new URL('../../backend/supabase/migrations/', import.meta.url)

function migrationSources() {
  return readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(new URL(name, migrationsDirectory), 'utf8'))
}

test('the variable catalog matches the latest database definition', () => {
  const definitions = migrationSources()
    .flatMap((sql) => [...sql.matchAll(/function private\.release_template_variables\(\)[\s\S]*?select array\[([^\]]*)\]/g)])
  const latest = definitions.at(-1)[1]
    .split(',')
    .map((item) => item.trim().replace(/'/g, ''))
  assert.deepEqual(RELEASE_VARIABLES.map(({ key }) => key), latest)
})

test('the Release types match the database enum', () => {
  const sql = migrationSources().find((source) => source.includes('create type valtrim.release_type'))
  const enumBody = sql.match(/create type valtrim\.release_type as enum \(([\s\S]*?)\);/)[1]
  const values = [...enumBody.matchAll(/'([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(RELEASE_TYPES.map(({ value }) => value), values)
})

test('every format offered by the client is accepted by the database rule', () => {
  const sql = migrationSources().filter((source) => source.includes('validate_release_template_mapping')).at(-1)
  for (const variable of RELEASE_VARIABLES) {
    for (const { value } of variable.formats) {
      assert.ok(sql.includes(`'${value}'`), `${variable.key} format ${value}`)
    }
  }
})
