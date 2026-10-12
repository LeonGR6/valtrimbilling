import { useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import PdfPreviewDialog from '../../../release-templates/components/PdfPreviewDialog.jsx'
import GeneratePackageReleaseDialog from '../../../release-templates/components/GeneratePackageReleaseDialog.jsx'
import GeneratePackageScheduleDialog from '../../../payment-schedules/components/GeneratePackageScheduleDialog.jsx'
import { buildPackageBundleFileName, mergePdfs } from '../../services/packageBundle.js'
import { useQuickbooksInvoicePdf } from '../../hooks/useQuickbooksInvoicePdf.js'
import { downloadQuickbooksInvoicePdf } from '../../services/quickbooksRepository.js'

const NOT_READY = { canGenerate: false, generating: false }

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

/**
 * The Release and the Payment Schedule of a Package in one step: both are
 * generated and saved as Package documents exactly as their own buttons do, and
 * the person gets them joined in a single PDF. Each part keeps its own options
 * and warnings; the Package is generated only when both are ready.
 */
export default function GeneratePackageDialog({ packageRecord, job, packages, onClose }) {
  const releaseRef = useRef(null)
  const scheduleRef = useRef(null)
  const [release, setRelease] = useState(NOT_READY)
  const [schedule, setSchedule] = useState(NOT_READY)
  const [step, setStep] = useState(null)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [preview, setPreview] = useState(null)
  const invoicePdf = useQuickbooksInvoicePdf(packageRecord)
  const hasQuickbooksInvoice = packageRecord.quickbooksStatus === 'CREATED'

  // QuickBooks' own PDF of the invoice, saved on the Package, goes first. A
  // Package that was never invoiced there simply has none.
  const loadInvoiceBytes = async () => (
    hasQuickbooksInvoice
      ? (await downloadQuickbooksInvoicePdf(packageRecord.id))?.bytes ?? null
      : null
  )
  const withInvoice = (invoiceBytes, ...documents) => (
    invoiceBytes ? [invoiceBytes, ...documents] : documents
  )

  // A part can be busy on its own too (building its own preview).
  const busy = step !== null || release.generating || schedule.generating
  const canGenerate = release.canGenerate && schedule.canGenerate && !busy

  // The documents as they would be generated, joined; nothing is saved.
  const showPreview = async () => {
    setError(null)
    setDone(null)
    setStep('previewing')
    try {
      const invoiceBytes = await loadInvoiceBytes()
      const builtRelease = await releaseRef.current.build()
      const builtSchedule = await scheduleRef.current.build()
      const { bytes } = await mergePdfs(withInvoice(invoiceBytes, builtRelease.bytes, builtSchedule.bytes))
      setPreview({
        bytes,
        fileName: buildPackageBundleFileName({
          jobCode: job.code,
          packageNumber: packageRecord.packageNumber,
        }),
      })
    } catch (previewError) {
      setError(previewError.message)
    } finally {
      setStep(null)
    }
  }

  const generate = async () => {
    setError(null)
    setDone(null)
    try {
      // Read first: if the saved invoice cannot be downloaded, nothing is generated or saved.
      setStep('invoice')
      const invoiceBytes = await loadInvoiceBytes()

      setStep('release')
      const generatedRelease = await releaseRef.current?.generate({ download: false })
      if (!generatedRelease) {
        setError('The Release could not be generated, so nothing was joined. See the message under Release.')
        return
      }

      setStep('schedule')
      const generatedSchedule = await scheduleRef.current?.generate({ download: false })
      if (!generatedSchedule) {
        setError('The Release was saved, but the Payment Schedule could not be generated, so nothing was joined. See the message under Payment Schedule.')
        return
      }

      setStep('merging')
      const { bytes, pageCount } = await mergePdfs(
        withInvoice(invoiceBytes, generatedRelease.bytes, generatedSchedule.bytes),
      )
      const fileName = buildPackageBundleFileName({
        jobCode: job.code,
        packageNumber: packageRecord.packageNumber,
      })
      saveToDisk(new Blob([bytes], { type: 'application/pdf' }), fileName)
      setDone({ fileName, pageCount, withInvoice: Boolean(invoiceBytes) })
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setStep(null)
    }
  }

  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={busy ? undefined : onClose}
      aria-labelledby="generate-package-title"
    >
      <DialogTitle id="generate-package-title">
        Generate Package (PDF)
        <Typography variant="body2" color="text.secondary">
          {packageRecord.packageNumber} · Job #{job.code}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            The Release and the Payment Schedule are generated, saved to this Package and
            downloaded together as one PDF, the Release first. When the Package has a saved
            QuickBooks invoice, it goes before them.
          </Typography>
          {hasQuickbooksInvoice && !invoicePdf.loading && !invoicePdf.pdf && (
            <Alert severity="info">
              The QuickBooks invoice PDF is not saved on this Package yet, so it will not be
              included. Use “Save PDF” on the Package page first to include it.
            </Alert>
          )}
          {!hasQuickbooksInvoice && (
            <Typography variant="caption" color="text.secondary">
              This Package has no QuickBooks invoice, so the invoice is not included.
            </Typography>
          )}

          <Box>
            <Typography variant="subtitle1" fontWeight={850} sx={{ mb: 1 }}>
              1. Release
            </Typography>
            <GeneratePackageReleaseDialog
              embedded
              ref={releaseRef}
              packageRecord={packageRecord}
              job={job}
              onReadyChange={setRelease}
              onClose={onClose}
            />
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle1" fontWeight={850} sx={{ mb: 1 }}>
              2. Payment Schedule
            </Typography>
            <GeneratePackageScheduleDialog
              embedded
              ref={scheduleRef}
              packageRecord={packageRecord}
              job={job}
              packages={packages}
              onReadyChange={setSchedule}
              onClose={onClose}
            />
          </Box>

          {!release.canGenerate && !busy && (
            <Alert severity="info">
              The Package can be generated when the Release is ready. See the message under Release.
            </Alert>
          )}
          {release.canGenerate && !schedule.canGenerate && !busy && (
            <Alert severity="info">
              The Package can be generated when the Payment Schedule is ready (and its
              differences are checked, if it lists any).
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {done && (
            <Alert severity="success" icon={<TaskAltRoundedIcon />}>
              The Release and the Payment Schedule were saved to this Package. Downloaded
              {done.withInvoice ? ' with the QuickBooks invoice first:' : ''}
              {' '}“{done.fileName}” ({done.pageCount} {done.pageCount === 1 ? 'page' : 'pages'}).
            </Alert>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Box sx={{ mr: 'auto' }}>
          <Button
            startIcon={step === 'previewing' ? <CircularProgress size={16} /> : <VisibilityRoundedIcon />}
            disabled={!canGenerate}
            onClick={showPreview}
          >
            {step === 'previewing' ? 'Building preview…' : 'Preview'}
          </Button>
        </Box>
        <Button onClick={onClose} disabled={busy}>Close</Button>
        <Button
          variant="contained"
          startIcon={step ? <CircularProgress size={18} color="inherit" /> : <DownloadRoundedIcon />}
          disabled={!canGenerate}
          onClick={generate}
        >
          {step ? STEP_LABELS[step] : 'Generate package'}
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
    </Dialog>
  )
}
