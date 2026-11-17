import { requireSupabase } from '../../../services/api.js'
import { sha256Hex } from '../../release-templates/services/packageRelease.js'
import { toPaymentScheduleTemplate } from './paymentScheduleRecord.js'
import { buildPackageScheduleStoragePath, PACKAGE_DOCUMENT_BUCKET } from './packageSchedule.js'

const TEMPLATE_COLUMNS = [
  'id',
  'job_document_id',
  'job_id',
  'layout',
  'detection_method',
  'page_count',
  'page_sizes',
  'detected_cells',
  'analysis',
  'mapping',
  'status',
  'error',
  'confirmed_by',
  'confirmed_at',
  'analyzed_at',
  'created_at',
  'updated_at',
].join(', ')

function fail(error, message) {
  return new Error(message, { cause: error })
}

function toSaveError(error) {
  switch (error.code) {
    case '42501':
      return fail(error, 'You do not have permission to save Package documents.')
    case '23514':
      // The database writes these messages for the reviewer.
      return fail(error, error.message)
    case '23503':
      return fail(error, 'The Package or the uploaded PDF is no longer available.')
    default:
      return fail(error, error.message || 'The Payment Schedule could not be saved.')
  }
}

/**
 * The confirmed Payment Schedules of a Job, each with the Storage location of
 * the PDF it was made from.
 */
export async function listConfirmedJobSchedules(jobId) {
  const client = await requireSupabase()
  const { data: rows, error } = await client
    .from('payment_schedule_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('job_id', Number(jobId))
    .eq('status', 'confirmed')

  if (error) throw fail(error, error.message || 'Payment Schedules could not be loaded.')

  const templates = (rows ?? []).map(toPaymentScheduleTemplate)
  if (templates.length === 0) return []

  const { data: documents, error: documentError } = await client
    .from('job_documents')
    .select('id, storage_bucket, storage_path, original_name')
    .in('id', templates.map((template) => template.documentId))

  if (documentError) {
    throw fail(documentError, documentError.message || 'Payment Schedule PDFs could not be loaded.')
  }

  const byId = new Map((documents ?? []).map((document) => [document.id, document]))
  return templates
    .map((template) => {
      const document = byId.get(template.documentId)
      return document
        ? {
            ...template,
            pdf: {
              bucket: document.storage_bucket,
              storagePath: document.storage_path,
              name: document.original_name,
            },
          }
        : null
    })
    .filter(Boolean)
}

/** The generated Payment Schedule of a Package: at most one, as a list. */
export async function listPackagePaymentSchedules(packageId) {
  const client = await requireSupabase()
  const { data: documents, error } = await client
    .from('package_documents')
    .select('id, label, status, file_id, completed_at')
    .eq('package_id', Number(packageId))
    .eq('document_type', 'PAYMENT_SCHEDULE')
    .not('file_id', 'is', null)

  if (error) throw fail(error, error.message || 'Package documents could not be loaded.')

  const fileIds = (documents ?? []).map((document) => document.file_id)
  if (fileIds.length === 0) return []

  const { data: files, error: fileError } = await client
    .from('stored_files')
    .select('id, bucket_id, object_path, original_filename, size_bytes')
    .in('id', fileIds)

  if (fileError) throw fail(fileError, fileError.message || 'Package files could not be loaded.')

  const byId = new Map((files ?? []).map((file) => [file.id, file]))
  return documents
    .map((document) => {
      const file = byId.get(document.file_id)
      return file
        ? {
            id: document.id,
            kind: 'payment_schedule',
            label: document.label,
            completedAt: document.completed_at,
            file: {
              bucket: file.bucket_id,
              storagePath: file.object_path,
              name: file.original_filename,
              sizeBytes: Number(file.size_bytes),
            },
          }
        : null
    })
    .filter(Boolean)
}

/**
 * Saves a highlighted Payment Schedule as the Package document: uploads it to
 * private Storage, registers it, and removes the file it replaced.
 */
export async function savePackagePaymentSchedule({ packageId, fileName, bytes }) {
  const client = await requireSupabase()
  const storagePath = buildPackageScheduleStoragePath(packageId, crypto.randomUUID())

  const { error: uploadError } = await client.storage
    .from(PACKAGE_DOCUMENT_BUCKET)
    .upload(storagePath, new Blob([bytes], { type: 'application/pdf' }), {
      cacheControl: '3600',
      contentType: 'application/pdf',
      upsert: false,
    })
  if (uploadError) {
    throw fail(uploadError, `Could not upload ${fileName}. Check your permissions and try again.`)
  }

  const { data, error: registrationError } = await client.rpc('register_package_payment_schedule', {
    p_package_id: Number(packageId),
    p_storage_path: storagePath,
    p_original_name: fileName,
    p_size_bytes: bytes.length,
    p_sha256: await sha256Hex(bytes),
  })

  if (registrationError) {
    // Do not leave an unregistered file behind.
    await client.storage.from(PACKAGE_DOCUMENT_BUCKET).remove([storagePath])
    throw toSaveError(registrationError)
  }

  const replaced = data?.replaced_storage_path
  if (replaced) {
    // Best effort: the new Payment Schedule is already saved either way.
    await client.storage.from(PACKAGE_DOCUMENT_BUCKET).remove([replaced]).catch(() => {})
  }

  return { documentId: data?.document_id ?? null, storagePath }
}

/**
 * Removes the generated Payment Schedule from a draft Package. The database
 * updates or deletes the rows and returns the PDF's Storage path; the PDF itself
 * is removed here because Storage objects cannot be deleted from SQL.
 */
export async function deletePackagePaymentSchedule(documentId) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('delete_package_payment_schedule', {
    p_document_id: Number(documentId),
  })

  if (error) {
    if (error.code === '42501') {
      throw fail(error, 'You do not have permission to remove Package documents.')
    }
    if (error.code === 'P0002') {
      throw fail(error, 'The Payment Schedule was already removed.')
    }
    throw fail(error, error.message || 'The Payment Schedule could not be removed.')
  }

  const path = data?.removed_storage_path
  if (path) {
    // Best effort: the Payment Schedule is already gone from the Package either way.
    await client.storage.from(PACKAGE_DOCUMENT_BUCKET).remove([path]).catch(() => {})
  }
}
