// The builders' Purchase Order PDFs kept per Job for its Extras / Change Orders.

export const PO_FILE_BUCKET = 'change-order-pos'
export const MAX_PO_FILE_SIZE = 25 * 1024 * 1024

export const PO_FILE_COLUMNS = [
  'id',
  'job_id',
  'storage_bucket',
  'storage_path',
  'original_name',
  'size_bytes',
  'content_sha256',
  'uploaded_by',
  'created_at',
  'read_status',
  'read_at',
  'read_error',
  'page_count',
  'ocr_pages',
].join(', ')

export const PO_ORDER_COLUMNS = [
  'id',
  'file_id',
  'job_id',
  'position',
  'po_number',
  'number_label',
  'document_kind',
  'issued_date',
  'pages',
  'builder_text',
  'project_text',
  'description',
  'total_amount',
  'net_amount',
  'other_numbers',
  'warnings',
  'change_order_po_lines(line_number, lots, lots_text, lots_checked, phase, building, plan, description, amount)',
].join(', ')

export const PO_KIND_LABELS = {
  PURCHASE_ORDER: 'Purchase Order',
  CHANGE_ORDER: 'Change Order',
  WORK_ORDER: 'Work Order',
  FIELD_PO: 'Field PO',
  CONTRACT: 'Contract',
  OTHER: 'Order',
}

export function toPoFile(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    bucket: row.storage_bucket,
    storagePath: row.storage_path,
    name: row.original_name,
    sizeBytes: Number(row.size_bytes),
    sha256: row.content_sha256,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    readStatus: row.read_status ?? 'UNREAD',
    readAt: row.read_at ?? null,
    readError: row.read_error ?? '',
    pageCount: row.page_count ?? null,
    ocrPages: row.ocr_pages ?? [],
  }
}

const amount = (value) => (value === null || value === undefined ? null : Number(value))

/** An order read from a PDF, with its lines in order. */
export function toPoOrder(row) {
  return {
    id: row.id,
    fileId: row.file_id,
    jobId: row.job_id,
    position: row.position,
    number: row.po_number ?? '',
    numberLabel: row.number_label ?? '',
    kind: row.document_kind,
    kindLabel: PO_KIND_LABELS[row.document_kind] ?? 'Order',
    issuedDate: row.issued_date ?? '',
    pages: row.pages ?? [],
    builder: row.builder_text ?? '',
    project: row.project_text ?? '',
    description: row.description ?? '',
    total: amount(row.total_amount),
    netTotal: amount(row.net_amount),
    otherNumbers: row.other_numbers ?? [],
    warnings: row.warnings ?? [],
    lines: [...(row.change_order_po_lines ?? [])]
      .sort((left, right) => left.line_number - right.line_number)
      .map((line) => ({
        lineNumber: line.line_number,
        lots: line.lots ?? [],
        lotsText: line.lots_text ?? '',
        lotsChecked: line.lots_checked === true,
        phase: line.phase ?? '',
        building: line.building ?? '',
        plan: line.plan ?? '',
        description: line.description ?? '',
        amount: amount(line.amount),
      })),
  }
}

/** The orders of each PDF (key: file id), in the order they are in the PDF. */
export function groupPoOrdersByFile(orders = []) {
  const byFile = {}
  for (const order of [...orders].sort((left, right) => left.position - right.position)) {
    ;(byFile[order.fileId] ??= []).push(order)
  }
  return byFile
}

/**
 * The Lots of an order in short: "Lots 12–17, 20" when they run in a row, "No Lot" when none is
 * printed (a sales office). Lots that are not plain numbers are listed as they are.
 */
export function describeOrderLots(order) {
  const lots = [...new Set(order.lines.flatMap((line) => line.lots))]
  if (lots.length === 0) return 'No Lot'
  const numeric = lots.every((lot) => /^\d+$/.test(lot))
  if (!numeric) return `${lots.length === 1 ? 'Lot' : 'Lots'} ${lots.join(', ')}`
  const sorted = [...new Set(lots.map(Number))].sort((left, right) => left - right)
  const parts = []
  let start = sorted[0]
  let previous = sorted[0]
  for (const lot of [...sorted.slice(1), null]) {
    if (lot !== null && lot === previous + 1) {
      previous = lot
      continue
    }
    parts.push(start === previous ? `${start}` : previous === start + 1 ? `${start}, ${previous}` : `${start}–${previous}`)
    start = lot
    previous = lot
  }
  return `${sorted.length === 1 ? 'Lot' : 'Lots'} ${parts.join(', ')}`
}

/** What a PDF's reading says in a few words. */
export function readStatusLabel(file, orderCount) {
  if (file.readStatus === 'READING') return 'Reading…'
  if (file.readStatus === 'FAILED') return 'Could not be read'
  if (file.readStatus === 'READ') return `${orderCount} ${orderCount === 1 ? 'order' : 'orders'} found`
  return 'Not read yet'
}

/** "<job id>/<id>.pdf": the first folder is the Job, which Storage checks. */
export function poFileStoragePath(jobId, fileId) {
  return `${Number(jobId)}/${fileId}.pdf`
}

/** The PDFs of each Job (key: Job id as text), newest first as they are read. */
export function groupPoFilesByJob(files = []) {
  const byJob = {}
  for (const file of files) {
    const key = String(file.jobId)
    ;(byJob[key] ??= []).push(file)
  }
  return byJob
}

/** Why a PDF cannot be uploaded, or '' when it can. */
export function poFileProblem(file) {
  const name = file?.name ?? ''
  if (!name.toLowerCase().endsWith('.pdf') || name.includes('/') || name.includes('\\')) return 'Only PDF files.'
  if (name.length > 255) return 'The file name is longer than 255 characters.'
  if (!(file.size > 0)) return 'The file is empty.'
  if (file.size > MAX_PO_FILE_SIZE) return 'The file is larger than 25 MB.'
  return ''
}

/** The hexadecimal SHA-256 of some bytes, so the same PDF is not uploaded twice to a Job. */
export async function sha256Hex(buffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A message a person can act on, from a database or Storage error. */
export function poFileErrorMessage(error, fallback) {
  if (!error) return fallback
  if (error.code === '42501' || error.statusCode === '403') {
    return 'You do not have permission to manage Purchase Orders.'
  }
  if (error.code === '23505') return error.message || 'This PDF was already uploaded to this Job.'
  if (error.code === '23503') return 'The Job is not active, or the uploaded PDF is no longer available.'
  if (error.code === '23514' || error.statusCode === '413') return 'Use a PDF file no larger than 25 MB.'
  if (error.code === 'P0002') return 'The PDF was already deleted.'
  if (error.code === '55000') return 'The PDF is still in Storage. Try deleting it again.'
  return error.message || fallback
}
