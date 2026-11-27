const reasons = {
  ATTACHMENT_FORMAT: 'Unsupported attachment format',
  ATTACHMENT_COUNT: 'Too many attachments',
  ATTACHMENT_SIZE: 'Invalid file size',
  ATTACHMENT_TOTAL_SIZE: 'Attachments exceed the total size limit',
  ATTACHMENT_METADATA: 'Invalid attachment metadata',
  ATTACHMENT_SIGNATURE: 'The file does not match its format',
  ANALYSIS_FAILED: 'A source could not be analyzed',
  EXTRACTION_FAILED: 'The information could not be extracted',
  ANALYSIS_INCOMPLETE: 'Required details are missing to create the request',
  WORKER_RETRIES_EXHAUSTED: 'Automatic retry attempts have been exhausted',
  WORKER_ERROR: 'Processing needs review',
  SOURCE_UNAVAILABLE: 'The source is unavailable for analysis',
  WORKER_CONTINUATION_REQUIRED: 'Analysis needs another run to finish',
  WORKER_TEMPORARY_FAILURE: 'Wait before continuing the retry',
  RECOVERY_PDF_PENDING: 'The request is saved; its PDF is incomplete',
}

export function canRetryEmailImport(receipt) {
  return Boolean(receipt?.updatedAt) && receipt?.requestId == null
    && receipt?.status === 'NEEDS_ATTENTION' && receipt?.sourceStatus === 'AVAILABLE'
}

export function emailImportProblemTitle(code) {
  return Object.hasOwn(reasons, code) ? reasons[code] : 'The import needs attention'
}

export function formatEmailImportDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not available'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value))
}
