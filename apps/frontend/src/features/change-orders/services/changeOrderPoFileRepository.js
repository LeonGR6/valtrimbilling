import { requireSupabase } from '../../../services/api.js'
import { functionErrorMessage } from '../../../services/functionErrors.js'
import {
  PO_FILE_BUCKET,
  PO_FILE_COLUMNS,
  PO_ORDER_COLUMNS,
  toPoOrder,
  poFileErrorMessage,
  poFileProblem,
  poFileStoragePath,
  sha256Hex,
  toPoFile,
} from './changeOrderPoFileRecord.js'
import { LINE_PO_COLUMNS, toLinePo } from './changeOrderLinePoRecord.js'

const fail = (error, fallback) => {
  throw new Error(poFileErrorMessage(error, fallback), { cause: error })
}

/** Every Purchase Order PDF, newest first. */
export async function listPoFiles() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('change_order_po_files')
    .select(PO_FILE_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) fail(error, 'The Purchase Orders could not be loaded.')
  return (data ?? []).map(toPoFile)
}

/** Every order read from the Purchase Order PDFs, with its lines. */
export async function listPoOrders() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('change_order_pos')
    .select(PO_ORDER_COLUMNS)
    .order('file_id')
    .order('position')
  if (error) fail(error, 'The orders read from the PDFs could not be loaded.')
  return (data ?? []).map(toPoOrder)
}

/**
 * Reads the orders inside a PDF (OCR for scanned pages, AI with every number checked against the
 * PDF). Replaces what an earlier reading found. Returns { orders, warnings, ocr_pages }.
 */
export async function readPoFile(fileId) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke('change-order-po-read', { body: { file_id: fileId } })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data, 'The PDF could not be read. Try again.'))
  }
  return data
}

/**
 * Uploads one PDF to a Job: the file goes to private Storage, then it is registered. If the
 * registration is refused (for example the same PDF is already there) the uploaded copy is removed.
 */
export async function uploadPoFile(jobId, file) {
  const problem = poFileProblem(file)
  if (problem) throw new Error(`${file.name}: ${problem}`)

  const bytes = await file.arrayBuffer()
  const signature = new TextDecoder().decode(bytes.slice(0, 5))
  if (signature !== '%PDF-') throw new Error(`${file.name}: this is not a PDF.`)
  const sha256 = await sha256Hex(bytes)

  const client = await requireSupabase()
  const storagePath = poFileStoragePath(jobId, crypto.randomUUID())
  const { error: uploadError } = await client.storage
    .from(PO_FILE_BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', contentType: 'application/pdf', upsert: false })
  if (uploadError) fail(uploadError, `${file.name} could not be uploaded.`)

  const { data: fileId, error } = await client.rpc('register_change_order_po_file', {
    p_job_id: Number(jobId),
    p_storage_path: storagePath,
    p_original_name: file.name,
    p_size_bytes: file.size,
    p_content_sha256: sha256,
  })
  if (error) {
    await client.storage.from(PO_FILE_BUCKET).remove([storagePath])
    fail(error, `${file.name} could not be registered.`)
  }
  return fileId
}

/** A link that opens the PDF for a minute. */
export async function poFileSignedUrl(poFile) {
  const client = await requireSupabase()
  const { data, error } = await client.storage
    .from(PO_FILE_BUCKET)
    .createSignedUrl(poFile.storagePath, 60)
  if (error) fail(error, 'The PDF could not be opened.')
  return data.signedUrl
}

/** Removes the PDF from Storage, then its record (which the database allows only once it is gone). */
export async function deletePoFile(poFile) {
  if (!poFile?.id || poFile.bucket !== PO_FILE_BUCKET || !poFile.storagePath) {
    throw new Error('Select a Purchase Order PDF to delete.')
  }
  const client = await requireSupabase()
  const { error: storageError } = await client.storage.from(PO_FILE_BUCKET).remove([poFile.storagePath])
  if (storageError) fail(storageError, `${poFile.name} could not be deleted.`)
  const { error } = await client.rpc('delete_change_order_po_file', { p_file_id: poFile.id })
  if (error) fail(error, `${poFile.name} could not be deleted.`)
}

/**
 * Which PO backs each line of the Extras / COs (worked out by the database from the orders read). With a
 * `changeOrderId`, only that Extra / CO; without, every one, for the Documents tab.
 */
export async function listLinePoMatches(changeOrderId = null) {
  const client = await requireSupabase()
  let query = client.from('change_order_line_po_matches').select(LINE_PO_COLUMNS)
  if (changeOrderId) query = query.eq('change_order_id', changeOrderId)
  const { data, error } = await query
  if (error) fail(error, 'The Purchase Orders of the Extras / COs could not be loaded.')
  return (data ?? []).map(toLinePo)
}
