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
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { usePersistentState, isStoredString } from '../../../../hooks/usePersistentState.js'
import { useReleaseTemplates } from '../../../release-templates/hooks/useReleaseTemplates.js'
import { usePaymentScheduleTemplates } from '../../../payment-schedules/hooks/usePaymentScheduleTemplates.js'
import { isPaymentScheduleDocumentType } from '../../../payment-schedules/services/paymentScheduleRecord.js'
import {
  usePurchaseOrderComparison,
  usePurchaseOrderLineLots,
  usePurchaseOrders,
} from '../../../purchase-orders/hooks/usePurchaseOrders.js'
import { summarizeJobDocumentRequirements } from '../../services/jobDocumentRecord.js'
import {
  filterJobsForDocuments,
  jobDocumentBuilderOptions,
  jobDocumentCommunityOptions,
  sortJobsMissingFirst,
} from '../../utils/jobDocumentFilters.js'
import DocumentDeleteDialog from './DocumentDeleteDialog.jsx'
import DocumentUploadDialog from './DocumentUploadDialog.jsx'
import JobDocumentSections from './JobDocumentSections.jsx'

// Loaded on demand: it brings the PDF viewer, which most visits never need.
const ReleaseTemplateReviewDialog = lazy(
  () => import('../../../release-templates/components/ReleaseTemplateReviewDialog.jsx'),
)
const PreliminaryNoticeEditorDialog = lazy(() => import('./PreliminaryNoticeEditorDialog.jsx'))
const PaymentScheduleReviewDialog = lazy(
  () => import('../../../payment-schedules/components/PaymentScheduleReviewDialog.jsx'),
)
const PurchaseOrderReviewDialog = lazy(
  () => import('../../../purchase-orders/components/PurchaseOrderReviewDialog.jsx'),
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
  const [search, setSearch] = usePersistentState('draw-invoice:documents:search', '', isStoredString)
  const [storedBuilderFilter, setBuilderFilter] = usePersistentState(
    'draw-invoice:documents:builder',
    'ALL',
    isStoredString,
  )
  const [storedCommunityFilter, setCommunityFilter] = usePersistentState(
    'draw-invoice:documents:community',
    'ALL',
    isStoredString,
  )
  const [missingOnly, setMissingOnly] = usePersistentState(
    'draw-invoice:documents:missing-only',
    false,
    (value) => typeof value === 'boolean',
  )
  // Every Job starts collapsed: opening one is the user's choice.
  const [expandedJobId, setExpandedJobId] = useState(null)
  const [uploadTarget, setUploadTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [noticeEditorJob, setNoticeEditorJob] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  // Documents waiting to be reviewed, each a Release, a Payment Schedule or a
  // Purchase Order (`kind`). The first one is open; `total` lets the dialog say
  // "Release 1 of 3".
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
  const scheduleDocumentIds = useMemo(
    () => Object.values(documentsByJob)
      .flat()
      .filter((document) => isPaymentScheduleDocumentType(document.documentType))
      .map((document) => document.id)
      .sort(),
    [documentsByJob],
  )
  const scheduleTemplates = usePaymentScheduleTemplates(scheduleDocumentIds)
  const purchaseOrderDocumentIds = useMemo(
    () => Object.values(documentsByJob)
      .flat()
      .filter((document) => document.documentType === 'PURCHASE_ORDER')
      .map((document) => document.id)
      .sort(),
    [documentsByJob],
  )
  const purchaseOrders = usePurchaseOrders(purchaseOrderDocumentIds)
  const builderOptions = useMemo(() => jobDocumentBuilderOptions(jobs), [jobs])
  // A remembered Builder or Community that no longer exists falls back to "All".
  const builderFilter = storedBuilderFilter === 'ALL'
    || builderOptions.some(({ id }) => id === storedBuilderFilter)
    ? storedBuilderFilter
    : 'ALL'
  const communityOptions = useMemo(
    () => jobDocumentCommunityOptions(jobs, builderFilter),
    [builderFilter, jobs],
  )
  const communityFilter = storedCommunityFilter === 'ALL'
    || communityOptions.includes(storedCommunityFilter)
    ? storedCommunityFilter
    : 'ALL'
  const scopedJobs = useMemo(
    () => filterJobsForDocuments(jobs, {
      search,
      builderId: builderFilter,
      community: communityFilter,
    }),
    [builderFilter, communityFilter, jobs, search],
  )
  const hasActiveFilters = Boolean(search.trim())
    || builderFilter !== 'ALL'
    || communityFilter !== 'ALL'
    || missingOnly
  const clearFilters = () => {
    setSearch('')
    setBuilderFilter('ALL')
    setCommunityFilter('ALL')
    setMissingOnly(false)
  }
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
  const isMissingDocuments = (job) => {
    const status = requirementStatuses[String(job.id)]
    return status?.summary.requiredCount > 0 && !status.summary.isComplete
  }
  const jobsMissingRequirements = scopedJobs.filter(isMissingDocuments)
  // Jobs that still need documents come first, so they are the first thing seen.
  const visibleJobs = sortJobsMissingFirst(
    missingOnly ? jobsMissingRequirements : scopedJobs,
    isMissingDocuments,
  )
  const openJobId = expandedJobId
  // The Purchase Orders of the open Job are placed in their Phase and say how many of
  // their options need a look. Only that Job is read, and only when it has a Purchase
  // Order that was analyzed.
  const openJobHasAnalyzedPurchaseOrder = openJobId !== null
    && (documentsByJob[String(openJobId)] ?? []).some((document) =>
      purchaseOrders.analysesByDocumentId[document.id]?.status === 'analyzed')
  const purchaseOrderComparison = usePurchaseOrderComparison(
    openJobHasAnalyzedPurchaseOrder ? openJobId : null,
    purchaseOrders.revision,
  )
  const purchaseOrderLots = usePurchaseOrderLineLots(
    openJobHasAnalyzedPurchaseOrder ? openJobId : null,
    purchaseOrders.revision,
  )

  const handleAddDocuments = async (files) => {
    if (!uploadTarget) return

    const { job, type } = uploadTarget
    try {
      const uploaded = await uploadJobDocuments({ job, type, files })
      // A Release is uploaded to be used as a template: go straight to the
      // review instead of waiting for a click on "Use as template".
      if (type.documentType === 'RELEASE' && uploaded?.length > 0) {
        openTemplateReview(uploaded.map((document) => ({ job, document, kind: 'release' })))
      }
      // A Payment Schedule is read the same way, in either layout (matrix or
      // list); the review asks whether it will be used as the Job's schedule.
      if (type.documentType === 'PAYMENT_SCHEDULE' && uploaded?.length > 0) {
        openTemplateReview(uploaded.map((document) => ({ job, document, kind: 'schedule' })))
      }
      // A Purchase Order is read for its options and compared with the Job's.
      if (type.documentType === 'PURCHASE_ORDER' && uploaded?.length > 0) {
        openTemplateReview(uploaded.map((document) => ({ job, document, kind: 'purchase-order' })))
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

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            sx={{ mt: 2.25, alignItems: { md: 'center' } }}
          >
            <TextField
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search Job, builder or community"
              size="small"
              aria-label="Search document Jobs"
              sx={{ flex: 2, minWidth: { md: 240 } }}
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
            <TextField
              select
              size="small"
              label="Builder"
              value={builderFilter}
              onChange={(event) => {
                setBuilderFilter(event.target.value)
                setCommunityFilter('ALL')
              }}
              sx={{ flex: 1, minWidth: { md: 180 } }}
            >
              <MenuItem value="ALL">All builders</MenuItem>
              {builderOptions.map(({ id, name }) => (
                <MenuItem key={id} value={id}>{name}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Community"
              value={communityFilter}
              onChange={(event) => setCommunityFilter(event.target.value)}
              sx={{ flex: 1, minWidth: { md: 180 } }}
            >
              <MenuItem value="ALL">All communities</MenuItem>
              {communityOptions.map((community) => (
                <MenuItem key={community} value={community}>{community}</MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              sx={{ flexShrink: 0, mx: 0 }}
              control={(
                <Switch
                  checked={missingOnly}
                  onChange={(event) => setMissingOnly(event.target.checked)}
                />
              )}
              label={`Only missing documents (${jobsMissingRequirements.length})`}
            />
            <Button
              color="inherit"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              sx={{ flexShrink: 0 }}
            >
              Clear filters
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }}>
            Showing {visibleJobs.length} of {jobs.length} {jobs.length === 1 ? 'Job' : 'Jobs'}.
          </Typography>
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
            const isExpanded = openJobId === job.id

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
                  {isExpanded && (
                    <JobDocumentSections
                      job={job}
                      documents={documents}
                      requiredTypeKeys={requiredTypeKeys}
                      canManage={canManageJobDocuments && job.isActive !== false}
                      openingDocumentId={openingDocumentId}
                      deletingDocumentId={deletingDocumentId}
                      releaseTemplates={releaseTemplates.templatesByDocumentId}
                      analyzingReleaseId={releaseTemplates.analyzingDocumentId}
                      scheduleTemplates={scheduleTemplates.templatesByDocumentId}
                      analyzingScheduleId={scheduleTemplates.analyzingDocumentId}
                      purchaseOrderAnalyses={purchaseOrders.analysesByDocumentId}
                      analyzingPurchaseOrderId={purchaseOrders.analyzingDocumentId}
                      purchaseOrderComparison={purchaseOrderComparison.lines}
                      purchaseOrderLots={purchaseOrderLots}
                      onAdd={(type) => setUploadTarget({ job, type })}
                      onOpen={openJobDocument}
                      onFillNotice={() => setNoticeEditorJob(job)}
                      onReviewTemplate={(document) => openTemplateReview([{ job, document, kind: 'release' }])}
                      onReviewSchedule={(document) => openTemplateReview([{ job, document, kind: 'schedule' }])}
                      onReviewPurchaseOrder={(document) => openTemplateReview([{ job, document, kind: 'purchase-order' }])}
                      onDelete={(document, type) => {
                        setDeleteError(null)
                        setDeleteTarget({
                          job,
                          type,
                          document,
                          template: (
                            isPaymentScheduleDocumentType(document.documentType)
                              ? scheduleTemplates.templatesByDocumentId[document.id]
                              : releaseTemplates.templatesByDocumentId[document.id]
                          ) ?? null,
                          isOnlyRequiredDocument:
                            requiredTypeKeys.includes(type.key)
                            && documents.filter(
                              (candidate) => candidate.typeKey === type.key,
                            ).length === 1,
                        })
                      }}
                    />
                  )}
                </AccordionDetails>
              </Accordion>
            )
          })}

          {visibleJobs.length === 0 && (
            <Card variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
              <FolderOpenRoundedIcon color="disabled" sx={{ fontSize: 42 }} />
              <Typography fontWeight={750} sx={{ mt: 1 }}>No Jobs match these filters</Typography>
              <Typography variant="body2" color="text.secondary">
                Clear the search and filters to return to the document library.
              </Typography>
              {hasActiveFilters && (
                <Button onClick={clearFilters} sx={{ mt: 1.5 }}>Clear filters</Button>
              )}
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
          {templateTarget.kind === 'purchase-order' ? (
            <PurchaseOrderReviewDialog
              key={templateTarget.document.id}
              job={templateTarget.job}
              document={templateTarget.document}
              purchaseOrders={purchaseOrders}
              canManage={canManageJobDocuments && templateTarget.job.isActive !== false}
              position={templateQueue.total > 1
                ? { index: templateQueue.total - templateQueue.items.length + 1, total: templateQueue.total }
                : null}
              onClose={closeTemplateReview}
            />
          ) : templateTarget.kind === 'schedule' ? (
            <PaymentScheduleReviewDialog
              key={templateTarget.document.id}
              job={templateTarget.job}
              document={templateTarget.document}
              templateState={scheduleTemplates}
              canManage={canManageJobDocuments && templateTarget.job.isActive !== false}
              position={templateQueue.total > 1
                ? { index: templateQueue.total - templateQueue.items.length + 1, total: templateQueue.total }
                : null}
              onClose={closeTemplateReview}
            />
          ) : (
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
          )}
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

      {noticeEditorJob && (
        <Suspense
          fallback={(
            <Backdrop open sx={{ zIndex: 'modal' }}>
              <CircularProgress color="inherit" />
            </Backdrop>
          )}
        >
          <PreliminaryNoticeEditorDialog
            job={noticeEditorJob}
            canManage={canManageJobDocuments && noticeEditorJob.isActive !== false}
            onClose={() => setNoticeEditorJob(null)}
          />
        </Suspense>
      )}
    </Box>
  )
}
