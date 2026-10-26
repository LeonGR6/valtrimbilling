import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded'
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import PdfPreviewDialog from '../../../release-templates/components/PdfPreviewDialog.jsx'
import GeneratePackageReleaseDialog from '../../../release-templates/components/GeneratePackageReleaseDialog.jsx'
import GeneratePackageScheduleDialog from '../../../payment-schedules/components/GeneratePackageScheduleDialog.jsx'
import { writeStoredValue } from '../../../../hooks/usePersistentState.js'
import { buildPackageBundleFileName, mergePdfs } from '../../services/packageBundle.js'
import { formatFileSize } from '../documents/jobDocumentTypes.js'
import PackageSubmissionPanel from './PackageSubmissionPanel.jsx'
import { describeSentPackage } from '../../services/packageSubmissionRecord.js'
import { packageDocumentNumber } from '../../utils/packageInvoiceLabel.js'
import DocumentThumbnail from './DocumentThumbnail.jsx'
import { useQuickbooksInvoicePdf } from '../../hooks/useQuickbooksInvoicePdf.js'
import {
  downloadQuickbooksInvoicePdf,
  saveQuickbooksInvoicePdf,
} from '../../services/quickbooksRepository.js'

const NOT_READY = { canGenerate: false, generating: false, previewing: false, loading: true }

const STEP_LABELS = {
  previewing: 'Building preview…',
  invoice: 'Reading the QuickBooks invoice…',
  release: 'Generating the Release…',
  schedule: 'Generating the Payment Schedule…',
  merging: 'Joining the documents…',
}

function saveToDisk(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const STATUS_ICONS = {
  success: <CheckCircleRoundedIcon fontSize="small" color="success" />,
  warning: <ErrorOutlineRoundedIcon fontSize="small" color="warning" />,
  default: <RemoveCircleOutlineRoundedIcon fontSize="small" color="disabled" />,
}

/**
 * One document of the Package: its number, state, whether it goes in the PDF,
 * its own actions and its content. `details` shows the file at a glance.
 */
function DocumentCard({
  number,
  title,
  description,
  status,
  include,
  fix,
  actions,
  details,
  anchorRef,
  children,
}) {
  return (
    <Paper
      ref={anchorRef}
      variant="outlined"
      sx={{
        borderRadius: 2,
        overflow: 'hidden',
        borderColor: status.tone === 'warning' ? 'warning.main' : 'divider',
        opacity: include && !include.checked ? 0.72 : 1,
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{
          px: 2.5,
          py: 1.75,
          alignItems: { sm: 'center' },
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'action.hover',
        }}
      >
        <Box
          aria-hidden="true"
          sx={{
            width: 32,
            height: 32,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '50%',
            color: 'primary.contrastText',
            bgcolor: 'primary.main',
            fontWeight: 800,
          }}
        >
          {number}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h6" component="h2" fontWeight={800}>
              {title}
            </Typography>
            <Chip size="small" color={status.tone} variant="outlined" label={status.label} />
          </Stack>
          <Typography variant="body2" color="text.secondary">{description}</Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {fix}
          {actions}
          {include && (
            <Tooltip title={include.hint ?? ''}>
              <span>
                <FormControlLabel
                  sx={{ m: 0 }}
                  disabled={include.disabled}
                  control={(
                    <Checkbox
                      size="small"
                      checked={include.checked}
                      onChange={(event) => include.onChange(event.target.checked)}
                    />
                  )}
                  label={<Typography variant="body2" fontWeight={650}>In the PDF</Typography>}
                />
              </span>
            </Tooltip>
          )}
        </Stack>
      </Stack>
      <Box sx={{ px: 2.5, py: 2 }}>
        {details}
        {children}
      </Box>
    </Paper>
  )
}

/** The thumbnail of a document with its page count and size. */
function DocumentGlance({ bytes, pages, onPages, caption }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}>
      <DocumentThumbnail bytes={bytes} onPages={onPages} />
      <Box>
        <Typography variant="body2" fontWeight={750}>
          {bytes
            ? [
                pages ? `${pages} ${pages === 1 ? 'page' : 'pages'}` : null,
                formatFileSize(bytes.length),
              ].filter(Boolean).join(' · ')
            : 'Preparing preview…'}
        </Typography>
        {caption && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {caption}
          </Typography>
        )}
      </Box>
    </Stack>
  )
}

function statusOf({ loading, canGenerate }) {
  if (loading) return { tone: 'default', label: 'Loading…' }
  return canGenerate
    ? { tone: 'success', label: 'Ready' }
    : { tone: 'warning', label: 'Needs attention' }
}

const FIXES = {
  missing_template: 'Go to Documents',
  unmatched: 'Go to Documents',
}

/**
 * The whole Package in one place, in the order it is joined: 1. the QuickBooks
 * invoice, 2. the Release and 3. the Payment Schedule. Each document can be
 * previewed, downloaded and left out on its own, and the ones that are in are
 * generated, saved to the Package and downloaded together as a single PDF.
 */
export default function GeneratePackageDialog({
  packageRecord,
  job,
  packages,
  // How this Builder receives its packages: { method, destination }.
  submission = { method: 'PORTAL', destination: '' },
  // Whether the billing setup of the Package asks for a Release and a Payment Schedule. One it does
  // not ask for starts out of the PDF and does not block generating it.
  requiresRelease = true,
  requiresPaymentSchedule = true,
  // The emails of this Package already sent, newest first, and a way to refresh them.
  submissions = [],
  onSent = null,
  onClose,
}) {
  const navigate = useNavigate()
  const releaseRef = useRef(null)
  const scheduleRef = useRef(null)
  const scheduleCardRef = useRef(null)
  const submissionRef = useRef(null)
  const [release, setRelease] = useState(NOT_READY)
  const [schedule, setSchedule] = useState(NOT_READY)
  const [included, setIncluded] = useState({
    invoice: true,
    release: requiresRelease,
    schedule: requiresPaymentSchedule,
  })
  const [step, setStep] = useState(null)
  const [completedSteps, setCompletedSteps] = useState([])
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  // The Package PDF as it was generated, for sending or printing it.
  const [generated, setGenerated] = useState(null)
  const [preview, setPreview] = useState(null)
  const [invoicePreview, setInvoicePreview] = useState(null)
  const [invoiceBusy, setInvoiceBusy] = useState(null)
  const [invoiceError, setInvoiceError] = useState(null)
  // The files as they stand now, for the thumbnails; nothing here is saved.
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [builtBytes, setBuiltBytes] = useState({ release: null, schedule: null })
  const [pageCounts, setPageCounts] = useState({ invoice: null, release: null, schedule: null })
  const invoicePdf = useQuickbooksInvoicePdf(packageRecord)
  const hasQuickbooksInvoice = packageRecord.quickbooksStatus === 'CREATED'
  const invoiceDocumentId = invoicePdf.pdf?.documentId ?? null
  const bundleFileName = buildPackageBundleFileName({
    jobCode: job.code,
    packageNumber: packageDocumentNumber(packageRecord),
  })

  // The next step appears under the documents once the Package is generated.
  useEffect(() => {
    if (generated) {
      submissionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    }
  }, [generated])

  // The invoice PDF is read once it is known to be saved.
  useEffect(() => {
    if (!invoiceDocumentId) return undefined

    let cancelled = false
    downloadQuickbooksInvoicePdf(packageRecord.id)
      .then((file) => {
        if (!cancelled) setInvoiceFile(file)
      })
      .catch(() => {
        if (!cancelled) setInvoiceFile(null)
      })
    return () => {
      cancelled = true
    }
  }, [invoiceDocumentId, packageRecord.id])

  // The Release and the Payment Schedule are built (not saved) once they are
  // ready and again when what they depend on changes.
  useEffect(() => {
    if (!release.canGenerate) return undefined

    let cancelled = false
    const timer = setTimeout(() => {
      releaseRef.current?.build()
        .then(({ bytes }) => {
          if (!cancelled) setBuiltBytes((current) => ({ ...current, release: bytes }))
        })
        .catch(() => {
          if (!cancelled) setBuiltBytes((current) => ({ ...current, release: null }))
        })
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [release.canGenerate, release.signature])

  useEffect(() => {
    if (!schedule.canGenerate) return undefined

    let cancelled = false
    const timer = setTimeout(() => {
      scheduleRef.current?.build()
        .then(({ bytes }) => {
          if (!cancelled) setBuiltBytes((current) => ({ ...current, schedule: bytes }))
        })
        .catch(() => {
          if (!cancelled) setBuiltBytes((current) => ({ ...current, schedule: null }))
        })
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [schedule.canGenerate, schedule.signature])

  const setPages = (key) => (count) => setPageCounts((current) => (
    current[key] === count ? current : { ...current, [key]: count }
  ))
  const setInclude = (key) => (checked) => setIncluded((current) => ({ ...current, [key]: checked }))

  // What goes into the PDF: a document that is left out, or an invoice that has
  // no saved PDF, is skipped.
  const useInvoice = included.invoice && hasQuickbooksInvoice && Boolean(invoicePdf.pdf)
  const useRelease = included.release
  const useSchedule = included.schedule

  const loadInvoice = async () => {
    if (invoiceFile) return invoiceFile
    const saved = await downloadQuickbooksInvoicePdf(packageRecord.id)
    if (!saved) throw new Error('The invoice PDF is not saved on this Package yet.')
    return saved
  }
  const loadInvoiceBytes = async () => (useInvoice ? (await loadInvoice()).bytes : null)

  // A part can be busy on its own too (building its own preview).
  const busy = step !== null || invoiceBusy !== null || release.generating || schedule.generating
  const anythingIncluded = useInvoice || useRelease || useSchedule
  const canGenerate = anythingIncluded
    && (!useRelease || release.canGenerate)
    && (!useSchedule || schedule.canGenerate)
    && !busy

  // --- The invoice on its own -------------------------------------------

  const runInvoiceAction = async (kind, action) => {
    setInvoiceError(null)
    setInvoiceBusy(kind)
    try {
      await action()
    } catch (actionError) {
      setInvoiceError(actionError.message)
    } finally {
      setInvoiceBusy(null)
    }
  }

  const previewInvoice = () => runInvoiceAction('previewing', async () => {
    const { name, bytes } = await loadInvoice()
    setInvoicePreview({ bytes, fileName: name })
  })

  const downloadInvoice = () => runInvoiceAction('downloading', async () => {
    const { name, bytes } = await loadInvoice()
    saveToDisk(new Blob([bytes], { type: 'application/pdf' }), name)
  })

  const fetchInvoicePdf = () => runInvoiceAction('saving', async () => {
    await saveQuickbooksInvoicePdf(packageRecord.id)
    invoicePdf.reload()
  })

  // --- The whole Package --------------------------------------------------

  // The documents as they would be generated, joined; nothing is saved.
  const showPreview = async () => {
    setError(null)
    setDone(null)
    setStep('previewing')
    try {
      const documents = []
      const invoiceBytes = await loadInvoiceBytes()
      if (invoiceBytes) documents.push(invoiceBytes)
      if (useRelease) documents.push((await releaseRef.current.build()).bytes)
      if (useSchedule) documents.push((await scheduleRef.current.build()).bytes)
      const { bytes } = await mergePdfs(documents)
      setPreview({ bytes, fileName: bundleFileName })
    } catch (previewError) {
      setError(previewError.message)
    } finally {
      setStep(null)
    }
  }

  const generate = async () => {
    setError(null)
    setDone(null)
    setGenerated(null)
    setCompletedSteps([])
    const finish = (name) => setCompletedSteps((current) => [...current, name])
    try {
      const documents = []

      // Read first: if the saved invoice cannot be downloaded, nothing is generated or saved.
      if (useInvoice) {
        setStep('invoice')
        documents.push(await loadInvoiceBytes())
        finish('invoice')
      }

      if (useRelease) {
        setStep('release')
        const generatedRelease = await releaseRef.current?.generate({ download: false })
        if (!generatedRelease) {
          setError('The Release could not be generated, so nothing was joined. See the message under Release.')
          return
        }
        documents.push(generatedRelease.bytes)
        finish('release')
      }

      if (useSchedule) {
        setStep('schedule')
        const generatedSchedule = await scheduleRef.current?.generate({ download: false })
        if (!generatedSchedule) {
          setError(
            useRelease
              ? 'The Release was saved, but the Payment Schedule could not be generated, so nothing was joined. See the message under Payment Schedule.'
              : 'The Payment Schedule could not be generated, so nothing was joined. See the message under Payment Schedule.',
          )
          return
        }
        documents.push(generatedSchedule.bytes)
        finish('schedule')
      }

      setStep('merging')
      const { bytes, pageCount } = await mergePdfs(documents)
      saveToDisk(new Blob([bytes], { type: 'application/pdf' }), bundleFileName)
      finish('merging')
      setGenerated({ bytes, fileName: bundleFileName })
      setDone({
        fileName: bundleFileName,
        pageCount,
        invoice: useInvoice,
        release: useRelease,
        schedule: useSchedule,
      })
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setStep(null)
    }
  }

  // --- Ways to fix what blocks a document ----------------------------------

  const goToDocuments = () => {
    writeStoredValue('draw-invoice:section', 'documents')
    onClose()
    navigate('/draw-invoice')
  }
  const reviewSchedule = () => scheduleCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const fixFor = (state) => {
    if (!state || state.loading || state.canGenerate || busy) return null
    if (FIXES[state.blocker]) {
      return (
        <Button size="small" variant="contained" disableElevation startIcon={<FolderOpenRoundedIcon />} onClick={goToDocuments}>
          {FIXES[state.blocker]}
        </Button>
      )
    }
    if (state.blocker === 'acknowledge') {
      return <Button size="small" variant="contained" disableElevation onClick={reviewSchedule}>Review differences</Button>
    }
    return null
  }

  // --- What each card shows -----------------------------------------------

  const invoiceStatus = !hasQuickbooksInvoice
    ? { tone: 'default', label: 'Not in QuickBooks' }
    : invoicePdf.loading
      ? { tone: 'default', label: 'Checking…' }
      : invoicePdf.pdf
        ? { tone: 'success', label: 'Ready' }
        : { tone: 'warning', label: 'PDF not saved' }
  // A document the setup does not ask for, that is left out and cannot be generated, only says so.
  // Ticking "In the PDF" brings it back like any other.
  const isNotNeeded = (required, isIncluded, state) => (
    !required && !isIncluded && !state.loading && !state.canGenerate
  )
  const releaseNotNeeded = isNotNeeded(requiresRelease, included.release, release)
  const scheduleNotNeeded = isNotNeeded(requiresPaymentSchedule, included.schedule, schedule)
  const releaseStatus = releaseNotNeeded ? { tone: 'default', label: 'Not required' } : statusOf(release)
  const scheduleStatus = scheduleNotNeeded ? { tone: 'default', label: 'Not required' } : statusOf(schedule)

  const summaryRow = (title, status, isIncluded, includedNote, leftOutNote = 'Left out of the PDF') => ({
    title,
    status: isIncluded ? status : { tone: 'default', label: 'Left out' },
    note: isIncluded ? includedNote : leftOutNote,
  })
  const summaryRows = [
    summaryRow(
      'Invoice',
      invoiceStatus,
      useInvoice,
      !hasQuickbooksInvoice
        ? 'No QuickBooks invoice'
        : invoicePdf.pdf ? 'QuickBooks PDF' : 'Not included until its PDF is saved',
    ),
    summaryRow(
      'Release',
      releaseStatus,
      useRelease,
      release.canGenerate ? 'Will be generated' : 'Needs attention',
      releaseNotNeeded ? 'Not required by the billing setup' : undefined,
    ),
    summaryRow(
      'Payment Schedule',
      scheduleStatus,
      useSchedule,
      schedule.canGenerate ? 'Will be generated' : 'Needs attention',
      scheduleNotNeeded ? 'Not required by the billing setup' : undefined,
    ),
  ]

  const progressSteps = [
    useInvoice && { key: 'invoice', label: 'Read the invoice' },
    useRelease && { key: 'release', label: 'Generate the Release' },
    useSchedule && { key: 'schedule', label: 'Generate the Payment Schedule' },
    { key: 'merging', label: 'Join and download' },
  ].filter(Boolean)
  const showProgress = step !== null && step !== 'previewing'
  const progressValue = (completedSteps.length / progressSteps.length) * 100

  const includedList = [
    done?.invoice && 'the QuickBooks invoice',
    done?.release && 'the Release',
    done?.schedule && 'the Payment Schedule',
  ].filter(Boolean)

  return (
    <Dialog
      open
      fullScreen
      onClose={busy ? undefined : onClose}
      aria-labelledby="generate-package-title"
    >
      <DialogTitle
        id="generate-package-title"
        sx={{
          px: 3,
          py: 1.75,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="span" fontWeight={850} sx={{ display: 'block' }}>
            Generate Package (PDF)
          </Typography>
          <Typography variant="body2" color="text.secondary" component="span" sx={{ display: 'block' }}>
            {packageRecord.packageNumber} · Job #{job.code}
          </Typography>
        </Box>
        <IconButton aria-label="Close" edge="end" onClick={onClose} disabled={busy}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: { xs: 2, md: 3 }, py: 3, bgcolor: 'background.default' }}>
        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' },
            alignItems: 'start',
            maxWidth: 1280,
            mx: 'auto',
          }}
        >
          <Stack spacing={2.5}>
            <DocumentCard
              number={1}
              title="Invoice"
              description="The QuickBooks invoice PDF saved on this Package."
              status={invoiceStatus}
              include={{
                checked: useInvoice,
                disabled: !hasQuickbooksInvoice || !invoicePdf.pdf,
                hint: hasQuickbooksInvoice && invoicePdf.pdf ? undefined : 'There is no invoice PDF to include',
                onChange: setInclude('invoice'),
              }}
              actions={hasQuickbooksInvoice && invoicePdf.pdf && (
                <>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={invoiceBusy === 'previewing' ? <CircularProgress size={16} /> : <VisibilityRoundedIcon />}
                    disabled={busy}
                    onClick={previewInvoice}
                  >
                    Preview
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disableElevation
                    startIcon={invoiceBusy === 'downloading' ? <CircularProgress size={16} color="inherit" /> : <DownloadRoundedIcon />}
                    disabled={busy}
                    onClick={downloadInvoice}
                  >
                    Download
                  </Button>
                </>
              )}
              details={hasQuickbooksInvoice && invoicePdf.pdf && (
                <DocumentGlance
                  bytes={invoiceFile?.bytes}
                  pages={pageCounts.invoice}
                  onPages={setPages('invoice')}
                  caption={[
                    invoicePdf.pdf.file.name,
                    invoicePdf.pdf.savedAt
                      ? `saved ${new Date(invoicePdf.pdf.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                      : null,
                  ].filter(Boolean).join(' · ')}
                />
              )}
            >
              <Stack spacing={1.5}>
                {!hasQuickbooksInvoice && (
                  <Typography variant="body2" color="text.secondary">
                    This Package has no QuickBooks invoice, so there is no invoice to include.
                    The Release and the Payment Schedule are generated as usual.
                  </Typography>
                )}
                {hasQuickbooksInvoice && invoicePdf.loading && (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <CircularProgress size={18} />
                    <Typography variant="body2" color="text.secondary">
                      Looking for the saved invoice PDF…
                    </Typography>
                  </Stack>
                )}
                {hasQuickbooksInvoice && !invoicePdf.loading && !invoicePdf.pdf && (
                  <Alert
                    severity="info"
                    action={(
                      <Button
                        color="inherit"
                        size="small"
                        startIcon={invoiceBusy === 'saving' ? <CircularProgress size={16} color="inherit" /> : <CloudDownloadRoundedIcon />}
                        disabled={busy}
                        onClick={fetchInvoicePdf}
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        Get PDF from QuickBooks
                      </Button>
                    )}
                  >
                    The QuickBooks invoice PDF is not saved on this Package yet, so it is not
                    included. Get it from QuickBooks to preview it, download it and join it.
                  </Alert>
                )}
                {invoiceError && <Alert severity="error">{invoiceError}</Alert>}
              </Stack>
            </DocumentCard>

            <DocumentCard
              number={2}
              title="Release"
              description="Filled from this Package with the Job's Release template."
              status={releaseStatus}
              include={{ checked: included.release, onChange: setInclude('release') }}
              fix={releaseNotNeeded ? null : fixFor(release)}
              actions={release.canGenerate && (
                <>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={release.previewing ? <CircularProgress size={16} /> : <VisibilityRoundedIcon />}
                    disabled={busy}
                    onClick={() => releaseRef.current?.showPreview()}
                  >
                    Preview
                  </Button>
                  <Tooltip title="Saves it to this Package and downloads it">
                    <span>
                      <Button
                        size="small"
                        variant="contained"
                        disableElevation
                        startIcon={<DownloadRoundedIcon />}
                        disabled={busy}
                        onClick={() => releaseRef.current?.generate({ download: true })}
                      >
                        Download
                      </Button>
                    </span>
                  </Tooltip>
                </>
              )}
              details={release.canGenerate && (
                <DocumentGlance
                  bytes={builtBytes.release}
                  pages={pageCounts.release}
                  onPages={setPages('release')}
                  caption="As it will be generated now"
                />
              )}
            >
              {releaseNotNeeded && (
                <Typography variant="body2" color="text.secondary">
                  The billing setup of this Package does not ask for a Release. Tick “In the PDF” to
                  add one anyway.
                </Typography>
              )}
              <Box sx={{ display: releaseNotNeeded ? 'none' : 'block' }}>
                <GeneratePackageReleaseDialog
                  embedded
                  hideInlinePreview
                  ref={releaseRef}
                  packageRecord={packageRecord}
                  packages={packages}
                  job={job}
                  onReadyChange={setRelease}
                  onClose={onClose}
                />
              </Box>
            </DocumentCard>

            <DocumentCard
              number={3}
              title="Payment Schedule"
              description="The Job's payment schedule up to this Package."
              status={scheduleStatus}
              include={{ checked: included.schedule, onChange: setInclude('schedule') }}
              anchorRef={scheduleCardRef}
              fix={scheduleNotNeeded ? null : fixFor(schedule)}
              actions={schedule.canGenerate && (
                <>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={schedule.previewing ? <CircularProgress size={16} /> : <VisibilityRoundedIcon />}
                    disabled={busy}
                    onClick={() => scheduleRef.current?.showPreview()}
                  >
                    Preview
                  </Button>
                  <Tooltip title="Saves it to this Package and downloads it">
                    <span>
                      <Button
                        size="small"
                        variant="contained"
                        disableElevation
                        startIcon={<DownloadRoundedIcon />}
                        disabled={busy}
                        onClick={() => scheduleRef.current?.generate({ download: true })}
                      >
                        Download
                      </Button>
                    </span>
                  </Tooltip>
                </>
              )}
              details={schedule.canGenerate && (
                <DocumentGlance
                  bytes={builtBytes.schedule}
                  pages={pageCounts.schedule}
                  onPages={setPages('schedule')}
                  caption="As it will be generated now"
                />
              )}
            >
              {scheduleNotNeeded && (
                <Typography variant="body2" color="text.secondary">
                  The billing setup of this Package does not ask for a Payment Schedule. Tick “In the
                  PDF” to add one anyway.
                </Typography>
              )}
              <Box sx={{ display: scheduleNotNeeded ? 'none' : 'block' }}>
                <GeneratePackageScheduleDialog
                  embedded
                  hideInlinePreview
                  ref={scheduleRef}
                  packageRecord={packageRecord}
                  job={job}
                  packages={packages}
                  onReadyChange={setSchedule}
                  onClose={onClose}
                />
              </Box>
            </DocumentCard>

            {generated && (
              <PackageSubmissionPanel
                anchorRef={submissionRef}
                method={submission.method}
                destination={submission.destination}
                submissions={submissions}
                onSent={onSent}
                bundle={generated}
                packageRecord={packageRecord}
                job={job}
                onDownload={() => saveToDisk(
                  new Blob([generated.bytes], { type: 'application/pdf' }),
                  generated.fileName,
                )}
              />
            )}
          </Stack>

          <Paper
            variant="outlined"
            sx={{ p: 2.5, borderRadius: 2, position: { lg: 'sticky' }, top: { lg: 0 } }}
          >
            <Typography variant="subtitle1" fontWeight={850}>Package PDF</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              One file, joined in this order. Each document that goes in is also saved to the Package.
            </Typography>
            <Stack spacing={1.25}>
              {summaryRows.map((row, index) => (
                <Stack key={row.title} direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                  {STATUS_ICONS[row.status.tone] ?? STATUS_ICONS.default}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={750}>
                      {index + 1}. {row.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{row.note}</Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 2, overflowWrap: 'anywhere' }}
            >
              File name: {bundleFileName}
            </Typography>
            {submissions.length > 0 && (
              <Alert severity="success" icon={<TaskAltRoundedIcon />} sx={{ mt: 2 }}>
                {describeSentPackage(submissions)}
              </Alert>
            )}

            {showProgress && (
              <Box sx={{ mt: 2 }} role="status" aria-live="polite">
                <LinearProgress variant="determinate" value={progressValue} sx={{ borderRadius: 1, mb: 1.25 }} />
                <Stack spacing={0.75}>
                  {progressSteps.map((item) => {
                    const finished = completedSteps.includes(item.key)
                    const active = step === item.key
                    return (
                      <Stack key={item.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        {finished
                          ? <CheckCircleRoundedIcon fontSize="small" color="success" />
                          : active
                            ? <CircularProgress size={18} />
                            : <RadioButtonUncheckedRoundedIcon fontSize="small" color="disabled" />}
                        <Typography
                          variant="body2"
                          color={finished || active ? 'text.primary' : 'text.secondary'}
                          fontWeight={active ? 750 : 400}
                        >
                          {item.label}
                        </Typography>
                      </Stack>
                    )
                  })}
                </Stack>
              </Box>
            )}

            {!anythingIncluded && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Every document is left out. Tick at least one to generate the PDF.
              </Alert>
            )}
            {useRelease && !release.loading && !release.canGenerate && !busy && (
              <Alert severity="info" sx={{ mt: 2 }}>
                The Package can be generated when the Release is ready. Fix it, or leave it out of the PDF.
              </Alert>
            )}
            {useSchedule && !schedule.loading && !schedule.canGenerate && !busy
              && (!useRelease || release.canGenerate) && (
              <Alert severity="info" sx={{ mt: 2 }}>
                The Package can be generated when the Payment Schedule is ready (and its
                differences are checked, if it lists any). Fix it, or leave it out of the PDF.
              </Alert>
            )}
            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            {done && (
              <Alert severity="success" icon={<TaskAltRoundedIcon />} sx={{ mt: 2 }}>
                Downloaded “{done.fileName}” ({done.pageCount} {done.pageCount === 1 ? 'page' : 'pages'})
                {includedList.length > 0 ? ` with ${includedList.join(', ')}` : ''}.
                {done.release || done.schedule ? ' The generated documents were saved to this Package.' : ''}
              </Alert>
            )}
          </Paper>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Box sx={{ mr: 'auto' }}>
          <Button
            startIcon={step === 'previewing' ? <CircularProgress size={16} /> : <VisibilityRoundedIcon />}
            disabled={!canGenerate}
            onClick={showPreview}
          >
            {step === 'previewing' ? 'Building preview…' : 'Preview package'}
          </Button>
        </Box>
        <Button onClick={onClose} disabled={busy}>Close</Button>
        <Button
          variant="contained"
          disableElevation
          startIcon={step ? <CircularProgress size={18} color="inherit" /> : <DownloadRoundedIcon />}
          disabled={!canGenerate}
          onClick={generate}
        >
          {step ? STEP_LABELS[step] : 'Generate package (PDF)'}
        </Button>
      </DialogActions>

      {preview && (
        <PdfPreviewDialog
          title="Package"
          subtitle={preview.fileName}
          bytes={preview.bytes}
          confirmLabel="Generate package"
          onConfirm={() => {
            setPreview(null)
            generate()
          }}
          onClose={() => setPreview(null)}
        />
      )}

      {invoicePreview && (
        <PdfPreviewDialog
          title="Invoice"
          subtitle={invoicePreview.fileName}
          statusNote="saved on this Package"
          bytes={invoicePreview.bytes}
          onClose={() => setInvoicePreview(null)}
        />
      )}
    </Dialog>
  )
}
