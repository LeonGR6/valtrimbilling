import { safeEmailWebLink } from './customerServiceEmailImportRepository.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const mimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const sourceStatuses = new Set(['PENDING', 'UPLOADING', 'AVAILABLE', 'REJECTED', 'LEGACY'])

function validFile(file) {
  return Number.isSafeInteger(file?.fileId) && file.fileId > 0
    && typeof file.originalFilename === 'string' && Boolean(file.originalFilename.trim())
    && mimeTypes.has(file.mimeType)
    && Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0
}

export function canOpenImportSource(file) {
  return file?.retention === 'STORED' && file.storedFileAvailable === true && validFile(file)
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function containsBinary(value) {
  if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true
  if (typeof value === 'string') return /data:[^,\s]*;base64\s*,/i.test(value)
    || /(^|[^A-Za-z0-9+/])(iVBORw0KGgo|\/9j\/)[A-Za-z0-9+/]{32,}={0,2}/.test(value)
  if (Array.isArray(value)) return value.some(containsBinary)
  return record(value) && Object.entries(value).some(([key, part]) => (
    ['contentbytes', 'imageurl', 'base64', 'imagebase64', 'bytes', 'binary', 'buffer', 'arraybuffer', 'blob']
      .includes(key.toLowerCase().replaceAll('_', '')) || containsBinary(part)
  ))
}

function validAttachment(file, version) {
  if (!record(file) || typeof file.attachmentId !== 'string' || !file.attachmentId.trim()
    || typeof file.originalFilename !== 'string' || !file.originalFilename.trim()
    || !mimeTypes.has(file.mimeType) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0
    || typeof file.isInline !== 'boolean' || typeof file.storedFileAvailable !== 'boolean'
    || !['STORED', 'GRAPH_ONLY'].includes(file.retention)) return false
  if (file.retention === 'GRAPH_ONLY') {
    if (version !== 2 || !file.mimeType.startsWith('image/') || file.fileId !== null || file.storedFileAvailable) return false
  } else if (version === 2 && file.mimeType !== 'application/pdf') return false
  else if (file.storedFileAvailable ? !validFile(file) : file.fileId !== null) return false
  const analysis = file.analysis
  return analysis === null || record(analysis) && analysis.sourceId === `attachment:${file.attachmentId}`
    && ['ANALYZED', 'FAILED'].includes(analysis.status)
    && (analysis.model === null || typeof analysis.model === 'string')
    && (analysis.text === null || typeof analysis.text === 'string')
    && (analysis.status === 'ANALYZED' ? record(analysis.structuredData) && analysis.error === null
      : analysis.structuredData === null && record(analysis.error)
        && typeof analysis.error.code === 'string' && typeof analysis.error.message === 'string')
}

function sourceAnalysis(analysis) {
  if (!analysis) return null
  return { sourceId: analysis.sourceId, status: analysis.status, model: analysis.model,
    text: analysis.text, structuredData: analysis.structuredData,
    error: analysis.error ? { code: analysis.error.code, message: analysis.error.message,
      retryable: analysis.error.retryable === true } : null }
}

function privateUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href
  } catch { /* Invalid URLs never become document or image sources. */ }
  throw new Error('The server did not return a valid private file link.')
}

// Read-only, using the signed-in actor. Paths and server credentials are never
// accepted from the browser; the existing endpoint checks file membership.
export function createCustomerServiceImportSourceRepository({ getClient }) {
  return {
    async list(importId) {
      if (!uuid.test(importId)) throw new Error('The email import identity is invalid.')
      const client = await getClient()
      const { data, error } = await client.rpc('read_customer_service_import_sources', {
        p_import_id: importId,
      })
      if (error) throw new Error(error.code === '42501'
        ? 'Your session does not have permission to read these attachments.'
        : 'The original attachments could not be loaded. Try again.', { cause: error })
      if (data?.importId !== importId || ![1, 2].includes(data.sourceContractVersion)
        || !sourceStatuses.has(data.sourceStatus) || !Array.isArray(data.attachments) || containsBinary(data)
        || data.attachments.some((file) => !validAttachment(file, data.sourceContractVersion))
        || new Set(data.attachments.map((file) => file.attachmentId)).size !== data.attachments.length
        || new Set(data.attachments.filter((file) => file.fileId !== null).map((file) => file.fileId)).size
          !== data.attachments.filter((file) => file.fileId !== null).length) {
        throw new Error('The server did not confirm the original attachment list.')
      }
      return { available: ['AVAILABLE', 'LEGACY'].includes(data.sourceStatus), sourceStatus: data.sourceStatus,
        sourceContractVersion: data.sourceContractVersion, webLink: safeEmailWebLink(data.webLink),
        attachments: data.attachments.map((file) => ({
          attachmentId: file.attachmentId, fileId: file.fileId, originalFilename: file.originalFilename,
          mimeType: file.mimeType, sizeBytes: file.sizeBytes, isInline: file.isInline === true,
          retention: file.retention, storedFileAvailable: file.storedFileAvailable, analysis: sourceAnalysis(file.analysis),
        })) }
    },
    async urls(importId, file) {
      if (!uuid.test(importId) || !canOpenImportSource(file)) throw new Error('The original file identity is invalid or no file is stored for this source.')
      const client = await getClient()
      const { data, error } = await client.functions.invoke('customer-service-import-source', {
        body: { importId, fileId: file.fileId },
      })
      if (error || data?.error) {
        throw new Error('The original file is unavailable. It may have been deleted or your access may have expired. Check your session and try again; retained extraction is still shown.', { cause: error })
      }
      if (data?.importId !== importId || data.fileId !== file.fileId
        || data.originalFilename !== file.originalFilename || data.mimeType !== file.mimeType
        || data.sizeBytes !== file.sizeBytes
        || !Number.isSafeInteger(data.expiresIn) || data.expiresIn <= 0) {
        throw new Error('The server did not confirm the selected original file.')
      }
      return { ...file, signedUrl: privateUrl(data.signedUrl), downloadUrl: privateUrl(data.downloadUrl),
        expiresIn: data.expiresIn }
    },
  }
}
