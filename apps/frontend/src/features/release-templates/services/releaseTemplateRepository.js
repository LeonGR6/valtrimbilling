import { requireSupabase } from '../../../services/api.js'
import { toReleaseTemplate } from './releaseTemplateRecord.js'
import { functionErrorMessage } from '../../../services/functionErrors.js'

const ANALYZE_FUNCTION = 'release-template-analyze'

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

function toConfirmError(error) {
  if (error.code === '42501') {
    return new Error('You do not have permission to confirm Release templates.', {
      cause: error,
    })
  }
  if (error.code === 'P0002') {
    return new Error('This Release template is no longer available.', { cause: error })
  }
  if (error.code === '55000') {
    return new Error(
      'This Release template cannot be confirmed in its current state. Reopen it.',
      { cause: error },
    )
  }
  if (error.code === '23505') {
    return new Error(
      'Another template for this Job and type was confirmed at the same time. Reopen it and try again.',
      { cause: error },
    )
  }
  // Validation messages from the database are written for the reviewer.
  return new Error(error.message || 'The template could not be confirmed.', {
    cause: error,
  })
}

export async function listReleaseTemplates(documentIds) {
  if (documentIds.length === 0) return {}

  const client = await requireSupabase()
  const { data, error } = await client
    .from('release_templates')
    .select(TEMPLATE_COLUMNS)
    .in('job_document_id', documentIds)

  if (error) {
    throw new Error(error.message || 'Release templates could not be loaded.', {
      cause: error,
    })
  }

  return Object.fromEntries(
    (data ?? []).map((row) => {
      const template = toReleaseTemplate(row)
      return [template.documentId, template]
    }),
  )
}

export async function analyzeReleaseTemplate(documentId, { force = false } = {}) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(ANALYZE_FUNCTION, {
    body: { job_document_id: documentId, force },
  })

  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data, 'The Release analysis failed.'), { cause: error })
  }
  return toReleaseTemplate(data.template)
}

export async function confirmReleaseTemplate({ templateId, releaseType, mapping }) {
  const client = await requireSupabase()
  const { error } = await client.rpc('confirm_release_template', {
    p_template_id: templateId,
    p_release_type: releaseType,
    p_mapping: mapping,
  })

  if (error) throw toConfirmError(error)
}

/** Downloads the private PDF through the signed-in session; no URL is exposed. */
export async function downloadReleasePdf(document) {
  const client = await requireSupabase()
  const { data, error } = await client.storage
    .from(document.bucket)
    .download(document.storagePath)

  if (error || !data) {
    throw new Error('The PDF could not be opened.', { cause: error })
  }
  return data
}
