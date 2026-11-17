export const JOB_DOCUMENT_BUCKET = 'job-documents'
export const MAX_JOB_DOCUMENT_SIZE = 25 * 1024 * 1024

// Every Job needs a Preliminary Notice, whatever its Builder's Billing Setup asks for.
export const ALWAYS_REQUIRED_TYPE_KEYS = ['preliminary-notice']

const documentTypeKeys = {
  PRELIMINARY_NOTICE: 'preliminary-notice',
  PURCHASE_ORDER: 'purchase-order',
  PAYMENT_SCHEDULE: 'payment-schedule',
  RELEASE: 'release',
  BACKUP: 'backup',
}

const storageFolders = {
  PRELIMINARY_NOTICE: 'preliminary_notice',
  PURCHASE_ORDER: 'purchase_order',
  PAYMENT_SCHEDULE: 'payment_schedule',
  RELEASE: 'release',
  BACKUP: 'backup',
}

export function toJobDocument(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    documentType: row.document_type,
    typeKey: documentTypeKeys[row.document_type] ?? null,
    bucket: row.storage_bucket,
    storagePath: row.storage_path,
    name: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    // Only a Preliminary Notice can be saved with blanks still empty.
    isComplete: row.is_complete !== false,
  }
}

export function buildJobDocumentStoragePath(jobId, documentType, documentId) {
  const folder = storageFolders[documentType]
  if (!folder) throw new Error('Select a supported Job document type.')
  return `${Number(jobId)}/${folder}/${documentId}.pdf`
}

/** The documents of one Job with the given ids, in the order of `ids`. */
export function findJobDocuments(documentsByJob, jobId, ids) {
  const documents = documentsByJob[String(jobId)] ?? []
  return ids
    .map((id) => documents.find((document) => document.id === id))
    .filter(Boolean)
}

/**
 * The documents of each Job and the document types it must have, read from the Billing Setup
 * version the Job is on. `requirementVersionByJob` (Job id -> setup version id) says which version
 * each Job's checklist is read from; a Job without an entry uses its own.
 */
export function buildJobDocumentLibrary(
  jobs,
  documentRows,
  requirementRows,
  requirementVersionByJob = {},
) {
  const documentsByJob = Object.fromEntries(
    jobs.map((job) => [String(job.id), []]),
  )
  const requiredTypeKeysByJob = Object.fromEntries(
    jobs.map((job) => [String(job.id), [...ALWAYS_REQUIRED_TYPE_KEYS]]),
  )
  const jobIdsByVersion = new Map()

  jobs.forEach((job) => {
    const versionKey = String(
      requirementVersionByJob[String(job.id)] ?? job.billingSetupVersionId,
    )
    const jobIds = jobIdsByVersion.get(versionKey) ?? []
    jobIds.push(String(job.id))
    jobIdsByVersion.set(versionKey, jobIds)
  })

  documentRows.map(toJobDocument).forEach((document) => {
    if (!document.typeKey) return
    const jobKey = String(document.jobId)
    if (!documentsByJob[jobKey]) documentsByJob[jobKey] = []
    documentsByJob[jobKey].push(document)
  })

  requirementRows.forEach((requirement) => {
    if (!requirement.is_required) return
    const typeKey = documentTypeKeys[requirement.document_type]
    if (!typeKey) return

    const jobIds = jobIdsByVersion.get(String(requirement.setup_version_id)) ?? []
    jobIds.forEach((jobKey) => {
      if (!requiredTypeKeysByJob[jobKey].includes(typeKey)) {
        requiredTypeKeysByJob[jobKey].push(typeKey)
      }
    })
  })

  return { documentsByJob, requiredTypeKeysByJob }
}

/**
 * Which setup version each Job's document checklist is read from: the version the Job is on, the
 * one it was created with or moved to with Change setup. A newer version of its Builder asks for
 * other documents only for the Jobs that take it. A Job with no version of its own (none was
 * recorded) reads its Builder's current (ACTIVE) one.
 */
export function pickRequirementVersions(jobs, activeVersionByBuilder) {
  return Object.fromEntries(jobs.map((job) => [
    String(job.id),
    job.billingSetupVersionId ?? activeVersionByBuilder.get(String(job.builderId)),
  ]))
}

export function summarizeJobDocumentRequirements(requiredTypeKeys, documents) {
  const required = [...new Set(requiredTypeKeys)]
  // A Preliminary Notice saved with blanks still empty does not satisfy its requirement.
  const uploadedTypeKeys = new Set(
    documents.filter(({ isComplete }) => isComplete !== false).map(({ typeKey }) => typeKey),
  )
  const missingTypeKeys = required.filter((typeKey) => !uploadedTypeKeys.has(typeKey))

  return {
    requiredCount: required.length,
    completedCount: required.length - missingTypeKeys.length,
    missingTypeKeys,
    isComplete: required.length === 0 || missingTypeKeys.length === 0,
  }
}

export function describeJobDocumentProgress(requiredTypeKeys, documents) {
  const summary = summarizeJobDocumentRequirements(requiredTypeKeys, documents)

  if (summary.requiredCount === 0) {
    return {
      ...summary,
      countLabel: '0 of 0',
      status: 'not-required',
      statusLabel: 'Not required',
    }
  }

  return {
    ...summary,
    countLabel: `${summary.completedCount} of ${summary.requiredCount}`,
    status: summary.isComplete ? 'complete' : 'missing',
    statusLabel: summary.isComplete
      ? 'Complete'
      : `Missing ${summary.missingTypeKeys.length}`,
  }
}

export function countPackagesMissingRequiredDocuments(
  packageJobIds,
  documentsByJob,
  requiredTypeKeysByJob,
) {
  return packageJobIds.reduce((missingPackageCount, jobId) => {
    const jobKey = String(jobId)
    const summary = summarizeJobDocumentRequirements(
      requiredTypeKeysByJob[jobKey] ?? [],
      documentsByJob[jobKey] ?? [],
    )

    if (summary.requiredCount > 0 && !summary.isComplete) {
      return missingPackageCount + 1
    }

    return missingPackageCount
  }, 0)
}
