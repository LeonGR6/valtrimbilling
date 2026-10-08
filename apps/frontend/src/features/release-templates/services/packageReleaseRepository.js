import { requireSupabase } from '../../../services/api.js'
import {
  buildPackageDocumentStoragePath,
  PACKAGE_DOCUMENT_BUCKET,
  sha256Hex,
  toPackageReleaseValues,
} from './packageRelease.js'
import { toReleaseTemplate } from './releaseTemplateRecord.js'

const TEMPLATE_COLUMNS = [
  'id',
  'job_document_id',
  'job_id',
  'release_type',
  'classification',
  'detection_method',
  'page_count',
  'page_sizes',
  'detected_fields',
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
      return fail(error, error.message || 'The Release could not be saved.')
  }
}

/** Cut-off date and invoice net amount of a Package. */
export async function getPackageReleaseValues(packageId) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('get_package_release_values', {
    p_package_id: Number(packageId),
  })

  if (error) throw fail(error, error.message || 'The Package values could not be loaded.')
  return toPackageReleaseValues(data)
}

/**
 * The confirmed Release templates of a Job, each with the Storage location of
 * the PDF it was made from.
 */
export async function listConfirmedJobTemplates(jobId) {
  const client = await requireSupabase()
  const { data: rows, error } = await client
    .from('release_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('job_id', Number(jobId))
    .eq('status', 'confirmed')

  if (error) throw fail(error, error.message || 'Release templates could not be loaded.')

  const templates = (rows ?? []).map(toReleaseTemplate)
  if (templates.length === 0) return []

  const { data: documents, error: documentError } = await client
    .from('job_documents')
    .select('id, storage_bucket, storage_path, original_name')
    .in('id', templates.map((template) => template.documentId))

  if (documentError) {
    throw fail(documentError, documentError.message || 'Template PDFs could not be loaded.')
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

/** Releases already generated for a Package. */
export async function listPackageReleases(packageId) {
  const client = await requireSupabase()
  const { data: documents, error } = await client
    .from('package_documents')
    .select('id, label, status, file_id, completed_at')
    .eq('package_id', Number(packageId))
    .eq('document_type', 'RELEASE')
    .order('completed_at', { ascending: false })

  if (error) throw fail(error, error.message || 'Package documents could not be loaded.')

  const fileIds = (documents ?? []).map((document) => document.file_id).filter(Boolean)
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

/** Downloads a private PDF through the signed-in session; no URL is exposed. */
export async function downloadStoredPdf({ bucket, storagePath }) {
  const client = await requireSupabase()
  const { data, error } = await client.storage.from(bucket).download(storagePath)

  if (error || !data) throw fail(error, 'The PDF could not be downloaded.')
  return data
}

/**
 * Saves a filled Release as a Package document: uploads it to private Storage,
 * registers it, and removes the file it replaced.
 */
export async function savePackageRelease({ packageId, releaseType, fileName, bytes }) {
  const client = await requireSupabase()
  const storagePath = buildPackageDocumentStoragePath(packageId, crypto.randomUUID())

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

  const { data, error: registrationError } = await client.rpc('register_package_release', {
    p_package_id: Number(packageId),
    p_release_type: releaseType,
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
    // Best effort: the new Release is already saved either way.
    await client.storage.from(PACKAGE_DOCUMENT_BUCKET).remove([replaced]).catch(() => {})
  }

  return { documentId: data?.document_id ?? null, storagePath }
}

/**
 * Removes a generated Release from a draft Package. The database deletes the
 * rows and returns the PDF's Storage path; the PDF itself is removed here
 * because Storage objects cannot be deleted from SQL.
 */
export async function deletePackageRelease(documentId) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('delete_package_release', {
    p_document_id: Number(documentId),
  })

  if (error) {
    if (error.code === '42501') {
      throw fail(error, 'You do not have permission to remove Package documents.')
    }
    if (error.code === 'P0002') {
      throw fail(error, 'The Release was already removed.')
    }
    throw fail(error, error.message || 'The Release could not be removed.')
  }

  const path = data?.removed_storage_path
  if (path) {
    // Best effort: the Release is already gone from the Package either way.
    await client.storage.from(PACKAGE_DOCUMENT_BUCKET).remove([path]).catch(() => {})
  }
}
