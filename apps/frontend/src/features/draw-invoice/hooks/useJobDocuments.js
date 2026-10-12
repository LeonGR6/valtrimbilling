import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import { findJobDocuments } from '../services/jobDocumentRecord.js'
import { notifyJobDocumentsChanged, onJobDocumentsChanged } from '../services/jobDocumentEvents.js'
import {
  createJobDocumentSignedUrl,
  deleteJobDocument,
  listJobDocumentLibrary,
  uploadJobDocument,
} from '../services/jobDocumentsRepository.js'

const emptyLibrary = {
  documentsByJob: {},
  requiredTypeKeysByJob: {},
}

export function useJobDocuments(jobs) {
  const { profile } = useAuth()
  const [library, setLibrary] = useState(emptyLibrary)
  const [initialized, setInitialized] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [openingDocumentId, setOpeningDocumentId] = useState(null)
  const [deletingDocumentId, setDeletingDocumentId] = useState(null)
  const [error, setError] = useState(null)
  const canManageJobDocuments = [
    'ADMIN',
    'ACCOUNTING',
    'PROJECT_MANAGEMENT',
  ].includes(profile?.role)

  // Announces a change this hook made itself, so it does not reload twice.
  const announcing = useRef(false)
  const notifyChanged = useCallback(() => {
    announcing.current = true
    try {
      notifyJobDocumentsChanged()
    } finally {
      announcing.current = false
    }
  }, [])

  const refreshJobDocuments = useCallback(async () => {
    if (!profile?.id) {
      setLibrary(emptyLibrary)
      setInitialized(false)
      setError(null)
      return emptyLibrary
    }

    setLoading(true)
    try {
      const nextLibrary = await listJobDocumentLibrary(jobs)
      setLibrary(nextLibrary)
      setInitialized(true)
      setError(null)
      return nextLibrary
    } catch (loadError) {
      setError(loadError.message)
      throw loadError
    } finally {
      setLoading(false)
    }
  }, [jobs, profile?.id])

  useEffect(() => {
    if (!profile?.id) {
      // Authentication is the source of truth for clearing document metadata.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLibrary(emptyLibrary)
      setInitialized(false)
      setError(null)
      setLoading(false)
      return undefined
    }

    refreshJobDocuments().catch(() => {})
    return undefined
  }, [profile?.id, refreshJobDocuments])

  // A document saved elsewhere (the Preliminary Notice editor) shows up here too.
  useEffect(() => onJobDocumentsChanged(() => {
    if (!announcing.current) refreshJobDocuments().catch(() => {})
  }), [refreshJobDocuments])

  const uploadJobDocuments = useCallback(async ({ job, type, files }) => {
    setUploading(true)
    try {
      const uploadedIds = []
      for (const file of files) {
        uploadedIds.push(await uploadJobDocument({
          jobId: job.id,
          documentType: type.documentType,
          file,
        }))
      }

      const nextLibrary = await listJobDocumentLibrary(jobs)
      setLibrary(nextLibrary)
      setError(null)
      notifyChanged()
      // The documents that were just added, so the screen can open them.
      return findJobDocuments(nextLibrary.documentsByJob, job.id, uploadedIds)
    } catch (uploadError) {
      try {
        const nextLibrary = await listJobDocumentLibrary(jobs)
        setLibrary(nextLibrary)
        setInitialized(true)
        notifyChanged()
      } catch {
        // Preserve the actionable upload error when a follow-up refresh fails.
      }
      setError(uploadError.message)
      throw uploadError
    } finally {
      setUploading(false)
    }
  }, [jobs, notifyChanged])

  const openJobDocument = useCallback(async (document) => {
    const previewWindow = window.open('', '_blank')
    if (previewWindow) previewWindow.opener = null
    setOpeningDocumentId(document.id)
    try {
      const signedUrl = await createJobDocumentSignedUrl(document)
      if (previewWindow) {
        previewWindow.location.href = signedUrl
      } else {
        window.location.assign(signedUrl)
      }
      setError(null)
    } catch (openError) {
      previewWindow?.close()
      setError(openError.message)
    } finally {
      setOpeningDocumentId(null)
    }
  }, [])

  const removeJobDocument = useCallback(async (document) => {
    setDeletingDocumentId(document.id)
    try {
      await deleteJobDocument(document)
      const nextLibrary = await listJobDocumentLibrary(jobs)
      setLibrary(nextLibrary)
      setError(null)
      notifyChanged()
    } catch (deleteError) {
      try {
        const nextLibrary = await listJobDocumentLibrary(jobs)
        setLibrary(nextLibrary)
        setInitialized(true)
        notifyChanged()
      } catch {
        // Preserve the deletion error if the follow-up refresh also fails.
      }
      setError(deleteError.message)
      throw deleteError
    } finally {
      setDeletingDocumentId(null)
    }
  }, [jobs, notifyChanged])

  return useMemo(() => ({
    ...library,
    loading,
    initialized,
    uploading,
    openingDocumentId,
    deletingDocumentId,
    error,
    canManageJobDocuments,
    refreshJobDocuments,
    uploadJobDocuments,
    openJobDocument,
    removeJobDocument,
  }), [
    canManageJobDocuments,
    error,
    library,
    loading,
    initialized,
    deletingDocumentId,
    openJobDocument,
    openingDocumentId,
    refreshJobDocuments,
    uploadJobDocuments,
    uploading,
    removeJobDocument,
  ])
}
