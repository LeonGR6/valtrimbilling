import { requireSupabase } from '../../../services/api.js'
import {
  buildJobDocumentLibrary,
  buildJobDocumentStoragePath,
  JOB_DOCUMENT_BUCKET,
  MAX_JOB_DOCUMENT_SIZE,
} from './jobDocumentRecord.js'

const DOCUMENT_COLUMNS = [
  'id',
  'job_id',
  'document_type',
  'storage_bucket',
  'storage_path',
  'original_name',
  'mime_type',
  'size_bytes',
  'uploaded_by',
  'created_at',
].join(', ')

const REQUIREMENT_COLUMNS = [
  'setup_version_id',
  'document_type',
  'is_required',
  'display_order',
].join(', ')

function toDocumentError(error, fallbackMessage) {
  if (!error) return null

  if (error.code === '42501' || error.statusCode === '403') {
    return new Error('You do not have permission to manage Job documents.', {
      cause: error,
    })
  }

  if (error.code === '23503') {
    return new Error('The Job or uploaded PDF is no longer available.', {
      cause: error,
    })
  }

  if (error.code === '23514' || error.statusCode === '413') {
    return new Error('Use a PDF file no larger than 25 MB.', { cause: error })
  }

  if (error.code === 'P0002') {
    return new Error('The PDF was already deleted or is no longer available.', {
      cause: error,
    })
  }

  if (error.code === '55000') {
    return new Error('The PDF is still present in Storage. Try deleting it again.', {
      cause: error,
    })
  }

  return new Error(error.message || fallbackMessage, { cause: error })
}

function throwDocumentError(error, fallbackMessage) {
  const nextError = toDocumentError(error, fallbackMessage)
  if (nextError) throw nextError
}

async function validatePdfFile(file) {
  const validName = file.name.length <= 255
    && file.name.toLowerCase().endsWith('.pdf')
    && !file.name.includes('/')
    && !file.name.includes('\\')
  const validSize = file.size > 0 && file.size <= MAX_JOB_DOCUMENT_SIZE
  const signature = validSize ? await file.slice(0, 5).text() : ''

  if (!validName || !validSize || signature !== '%PDF-') {
    throw new Error(
      'Use a valid PDF file no larger than 25 MB. Renaming another file to .pdf is not supported.',
    )
  }
}

export async function listJobDocumentLibrary(jobs) {
  if (jobs.length === 0) {
    return buildJobDocumentLibrary([], [], [])
  }

  const client = await requireSupabase()
  const jobIds = [...new Set(jobs.map(({ id }) => Number(id)))]
  const versionIds = [
    ...new Set(
      jobs
        .map(({ billingSetupVersionId }) => Number(billingSetupVersionId))
        .filter(Number.isFinite),
    ),
  ]
  const documentRequest = client
    .from('job_documents')
    .select(DOCUMENT_COLUMNS)
    .in('job_id', jobIds)
    .order('created_at', { ascending: false })
  const requirementRequest = versionIds.length > 0
    ? client
        .from('billing_required_documents')
        .select(REQUIREMENT_COLUMNS)
        .in('setup_version_id', versionIds)
        .eq('is_required', true)
        .order('display_order', { ascending: true })
    : Promise.resolve({ data: [], error: null })
  const [documentResult, requirementResult] = await Promise.all([
    documentRequest,
    requirementRequest,
  ])

  throwDocumentError(documentResult.error, 'Job documents could not be loaded.')
  throwDocumentError(requirementResult.error, 'Document requirements could not be loaded.')

  return buildJobDocumentLibrary(
    jobs,
    documentResult.data ?? [],
    requirementResult.data ?? [],
  )
}

export async function uploadJobDocument({ jobId, documentType, file }) {
  await validatePdfFile(file)
  const client = await requireSupabase()
  const documentId = crypto.randomUUID()
  const storagePath = buildJobDocumentStoragePath(jobId, documentType, documentId)
  const { error: uploadError } = await client.storage
    .from(JOB_DOCUMENT_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      contentType: 'application/pdf',
      upsert: false,
    })

  throwDocumentError(uploadError, `Could not upload ${file.name}.`)

  const { error: registrationError } = await client.rpc('register_job_document', {
    p_job_id: Number(jobId),
    p_document_type: documentType,
    p_storage_path: storagePath,
    p_original_name: file.name,
    p_size_bytes: file.size,
  })

  if (registrationError) {
    await client.storage.from(JOB_DOCUMENT_BUCKET).remove([storagePath])
    throwDocumentError(registrationError, `Could not register ${file.name}.`)
  }
}

export async function createJobDocumentSignedUrl(document) {
  const client = await requireSupabase()
  const { data, error } = await client.storage
    .from(document.bucket)
    .createSignedUrl(document.storagePath, 60)

  throwDocumentError(error, 'The PDF could not be opened.')
  return data.signedUrl
}

export async function deleteJobDocument(document) {
  if (
    !document?.id
    || document.bucket !== JOB_DOCUMENT_BUCKET
    || !document.storagePath
  ) {
    throw new Error('Select a valid Job PDF to delete.')
  }

  const client = await requireSupabase()
  const { error: storageError } = await client.storage
    .from(JOB_DOCUMENT_BUCKET)
    .remove([document.storagePath])

  throwDocumentError(storageError, `Could not delete ${document.name}.`)

  const { error: metadataError } = await client.rpc('delete_job_document', {
    p_document_id: document.id,
  })

  throwDocumentError(metadataError, `Could not finish deleting ${document.name}.`)
}
