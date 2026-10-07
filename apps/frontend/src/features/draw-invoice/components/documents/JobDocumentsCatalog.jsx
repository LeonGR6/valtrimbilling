import { lazy, Suspense, useMemo, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Backdrop,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { useReleaseTemplates } from '../../../release-templates/hooks/useReleaseTemplates.js'
import { summarizeJobDocumentRequirements } from '../../services/jobDocumentRecord.js'
import DocumentCategoryCard from './DocumentCategoryCard.jsx'
import DocumentDeleteDialog from './DocumentDeleteDialog.jsx'
import DocumentUploadDialog from './DocumentUploadDialog.jsx'
import { DOCUMENT_TYPES } from './jobDocumentTypes.js'

// Loaded on demand: it brings the PDF viewer, which most visits never need.
const ReleaseTemplateReviewDialog = lazy(
  () => import('../../../release-templates/components/ReleaseTemplateReviewDialog.jsx'),
)

function jobRequirementStatus(requiredTypeKeys, documents) {
  const summary = summarizeJobDocumentRequirements(requiredTypeKeys, documents)

  if (summary.requiredCount === 0) {
    return {
      color: 'default',
      label: 'No documents required',
      Icon: FolderOpenRoundedIcon,
      summary,
    }
  }

  if (summary.isComplete) {
    return {
      color: 'success',
      label: 'Required documents complete',
      Icon: CheckCircleRoundedIcon,
      summary,
    }
  }

  return {
    color: 'warning',
    label: `${summary.missingTypeKeys.length} required ${summary.missingTypeKeys.length === 1 ? 'document' : 'documents'} missing`,
    Icon: WarningAmberRoundedIcon,
    summary,
  }
}

export default function JobDocumentsCatalog({ jobs, documentState }) {
  const [search, setSearch] = useState('')
  const [expandedJobId, setExpandedJobId] = useState(jobs[0]?.id ?? null)
  const [uploadTarget, setUploadTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  // Release documents waiting to be reviewed as templates. The first one is
  // open; `total` lets the dialog say "Release 1 of 3".
  const [templateQueue, setTemplateQueue] = useState({ items: [], total: 0 })
  const templateTarget = templateQueue.items[0] ?? null
  const openTemplateReview = (items) => setTemplateQueue({ items, total: items.length })
  const closeTemplateReview = () => setTemplateQueue((queue) => ({
    ...queue,
    items: queue.items.slice(1),
  }))
  const {
    documentsByJob,
    requiredTypeKeysByJob,
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
  } = documentState
  const releaseDocumentIds = useMemo(
    () => Object.values(documentsByJob)
      .flat()
      .filter((document) => document.documentType === 'RELEASE')
      .map((document) => document.id)
      .sort(),
    [documentsByJob],
  )
  const releaseTemplates = useReleaseTemplates(releaseDocumentIds)
  const normalizedSearch = search.trim().toLowerCase()
  const visibleJobs = jobs.filter((job) => {
    if (!normalizedSearch) return true

    return [job.code, job.builder, job.community]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch))
  })
  const requirementStatuses = useMemo(
    () => Object.fromEntries(jobs.map((job) => {
      const jobKey = String(job.id)
      return [
        jobKey,
        jobRequirementStatus(
          requiredTypeKeysByJob[jobKey] ?? [],
          documentsByJob[jobKey] ?? [],
        ),
      ]
    })),
    [documentsByJob, jobs, requiredTypeKeysByJob],
  )
  const jobsMissingRequirements = jobs.filter((job) => {
    const status = requirementStatuses[String(job.id)]
    return status?.summary.requiredCount > 0 && !status.summary.isComplete
  })

  const handleAddDocuments = async (files) => {
    if (!uploadTarget) return

    const { job, type } = uploadTarget
    try {
      const uploaded = await uploadJobDocuments({ job, type, files })
      // A Release is uploaded to be used as a template: go straight to the
      // review instead of waiting for a click on "Use as template".
      if (type.documentType === 'RELEASE' && uploaded?.length > 0) {
        openTemplateReview(uploaded.map((document) => ({ job, document })))
      }
    } catch {
      // The hook exposes the actionable error and refreshes any successful files.
    } finally {
      setUploadTarget(null)
    }
  }

  const handleDeleteDocument = async () => {
    if (!deleteTarget) return

    setDeleteError(null)
    try {
      await removeJobDocument(deleteTarget.document)
      setDeleteTarget(null)
    } catch (nextError) {
      setDeleteError(nextError.message)
    }
  }

  return (
    <Box sx={{ p: { xs: 2.5, md: 4 } }}>
      <Card variant="outlined" sx={{ mb: 2.5 }}>
        <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Box
                sx={{
                  width: 46,
                  height: 46,
                  flexShrink: 0,
                  borderRadius: 1.5,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'primary.light',
                  color: 'primary.main',
                }}
              >
                <FolderOpenRoundedIcon />
              </Box>
              <Box>
                <Typography variant="h6" fontWeight={850}>Job document center</Typography>
                <Typography variant="body2" color="text.secondary">
                  Expand a Job to review its files. Requirements follow its Builder billing setup.
                </Typography>
              </Box>
            </Stack>
            <TextField
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search Job, builder or community"
              size="small"
              aria-label="Search document Jobs"
              sx={{ width: { xs: '100%', md: 340 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon color="action" />
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Stack>
        </CardContent>
      </Card>

      {error && (
        <Alert
          severity="error"
          action={(
            <Button
              color="inherit"
              onClick={() => refreshJobDocuments().catch(() => {})}
            >
              Retry
            </Button>
          )}
          sx={{ mb: 2.5 }}
        >
          {error}
        </Alert>
      )}

      {!error && !loading && jobs.length > 0 && (
        <Alert
          severity={jobsMissingRequirements.length > 0 ? 'warning' : 'success'}
          sx={{ mb: 2.5 }}
        >
          {jobsMissingRequirements.length > 0
            ? `${jobsMissingRequirements.length} ${jobsMissingRequirements.length === 1 ? 'Job is' : 'Jobs are'} missing required submission documents.`
            : 'Every Job has all required submission document types.'}
        </Alert>
      )}

      {loading && (
        <Box sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
          <Stack spacing={1.25} sx={{ alignItems: 'center' }}>
            <CircularProgress size={30} />
            <Typography variant="body2" color="text.secondary">
              Loading Job documents and Builder requirements…
            </Typography>
          </Stack>
        </Box>
      )}

      {!loading && initialized && (
        <Stack spacing={2}>
          {visibleJobs.map((job) => {
            const jobKey = String(job.id)
            const documents = documentsByJob[jobKey] ?? []
            const requiredTypeKeys = requiredTypeKeysByJob[jobKey] ?? []
            const status = requirementStatuses[jobKey]
            const StatusIcon = status.Icon
            const jobCode = job.code ?? job.id
            const isExpanded = expandedJobId === job.id

            return (
              <Accordion
                key={job.id}
                expanded={isExpanded}
                onChange={(_, expanded) => setExpandedJobId(expanded ? job.id : null)}
                disableGutters
                elevation={0}
                sx={{
                  border: 1,
                  borderColor: isExpanded
                    ? 'primary.main'
                    : status.summary.isComplete ? 'divider' : 'warning.main',
                  borderRadius: '10px !important',
                  overflow: 'hidden',
                  bgcolor: 'background.paper',
                  '&::before': { display: 'none' },
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreRoundedIcon />}
                  aria-controls={`job-${job.id}-documents`}
                  id={`job-${job.id}-documents-header`}
                  sx={{
                    minHeight: 84,
                    '& .MuiAccordionSummary-content': { my: 1.5, minWidth: 0 },
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    sx={{
                      width: '100%',
                      pr: 1,
                      minWidth: 0,
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      justifyContent: 'space-between',
                    }}
                  >
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                      <Box
                        sx={{
                          width: 44,
                          height: 44,
                          flexShrink: 0,
                          borderRadius: 1.5,
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: 'primary.light',
                          color: 'primary.main',
                        }}
                      >
                        <FolderOpenRoundedIcon />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight={850}>Job #{jobCode}</Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {job.builder} · {job.community}
                        </Typography>
                      </Box>
                    </Stack>
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${documents.length} ${documents.length === 1 ? 'document' : 'documents'}`}
                      />
                      <Chip
                        size="small"
                        color={status.color}
                        icon={<StatusIcon />}
                        label={status.label}
                      />
                    </Stack>
                  </Stack>
                </AccordionSummary>

                <Divider />
                <AccordionDetails
                  id={`job-${job.id}-documents`}
                  sx={{ p: { xs: 2, sm: 2.5 } }}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                      gap: 2,
                      alignItems: 'stretch',
                    }}
                  >
                    {DOCUMENT_TYPES.map((type) => (
                      <DocumentCategoryCard
                        key={type.key}
                        type={type}
                        documents={documents.filter((document) => document.typeKey === type.key)}
                        required={requiredTypeKeys.includes(type.key)}
                        canManage={canManageJobDocuments && job.isActive !== false}
                        openingDocumentId={openingDocumentId}
                        deletingDocumentId={deletingDocumentId}
                        templatesByDocument={releaseTemplates.templatesByDocumentId}
                        analyzingDocumentId={releaseTemplates.analyzingDocumentId}
                        onReviewTemplate={(document) => openTemplateReview([{ job, document }])}
                        onAdd={() => setUploadTarget({ job, type })}
                        onDelete={(document) => {
                          setDeleteError(null)
                          setDeleteTarget({
                            job,
                            type,
                            document,
                            template: releaseTemplates.templatesByDocumentId[document.id] ?? null,
                            isOnlyRequiredDocument:
                              requiredTypeKeys.includes(type.key)
                              && documents.filter(
                                (candidate) => candidate.typeKey === type.key,
                              ).length === 1,
                          })
                        }}
                        onOpen={openJobDocument}
                      />
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )
          })}

          {visibleJobs.length === 0 && (
            <Card variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
              <FolderOpenRoundedIcon color="disabled" sx={{ fontSize: 42 }} />
              <Typography fontWeight={750} sx={{ mt: 1 }}>No Jobs match this search</Typography>
              <Typography variant="body2" color="text.secondary">
                Clear the search to return to the document library.
              </Typography>
            </Card>
          )}
        </Stack>
      )}

      {uploadTarget && (
        <DocumentUploadDialog
          key={`${uploadTarget.job.id}-${uploadTarget.type.key}`}
          job={uploadTarget.job}
          type={uploadTarget.type}
          uploading={uploading}
          onClose={() => setUploadTarget(null)}
          onAdd={handleAddDocuments}
        />
      )}

      {templateTarget && (
        <Suspense
          fallback={(
            <Backdrop open sx={{ zIndex: 'modal' }}>
              <CircularProgress color="inherit" />
            </Backdrop>
          )}
        >
          <ReleaseTemplateReviewDialog
            key={templateTarget.document.id}
            job={templateTarget.job}
            document={templateTarget.document}
            templateState={releaseTemplates}
            canManage={canManageJobDocuments && templateTarget.job.isActive !== false}
            position={templateQueue.total > 1
              ? { index: templateQueue.total - templateQueue.items.length + 1, total: templateQueue.total }
              : null}
            onClose={closeTemplateReview}
          />
        </Suspense>
      )}

      {deleteTarget && (
        <DocumentDeleteDialog
          target={deleteTarget}
          deleting={deletingDocumentId === deleteTarget.document.id}
          error={deleteError}
          onClose={() => {
            if (deletingDocumentId) return
            setDeleteTarget(null)
            setDeleteError(null)
          }}
          onDelete={handleDeleteDocument}
        />
      )}
    </Box>
  )
}
