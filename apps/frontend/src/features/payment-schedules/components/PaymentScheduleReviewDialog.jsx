import { Suspense, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { loadTemplateAndPdf } from '../../release-templates/services/releaseTemplateLoader.js'
import { downloadReleasePdf } from '../../release-templates/services/releaseTemplateRepository.js'
import { listJobPhases } from '../services/paymentScheduleRepository.js'
import { describeTemplateStatus } from '../services/paymentScheduleRecord.js'
import PaymentScheduleEditor from './PaymentScheduleEditor.jsx'

function Waiting({ title, children }) {
  return (
    <DialogContent dividers sx={{ display: 'grid', placeItems: 'center' }}>
      <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <CircularProgress />
        <Typography fontWeight={750}>{title}</Typography>
        {children && (
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
            {children}
          </Typography>
        )}
      </Stack>
    </DialogContent>
  )
}

/**
 * Opens a Payment Schedule document as a template. When it
 * has not been analyzed, or the last analysis failed, it analyzes first and then
 * shows the PDF with the detected amounts so the reviewer can check and confirm.
 */
export default function PaymentScheduleReviewDialog({
  job,
  document,
  templateState,
  canManage,
  position = null,
  onClose,
}) {
  const [loaded, setLoaded] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [step, setStep] = useState('analyzing')
  // The template as it was when the dialog opened; later updates arrive through
  // `loaded`, so the opening effect does not depend on changing state.
  const initialTemplate = useRef(templateState.templatesByDocumentId[document.id] ?? null)
  // One request per attempt: React may run the effect more than once for the
  // same attempt, and a second analysis would be rejected as already running.
  const request = useRef({ attempt: null, promise: null })
  const { analyze } = templateState

  useEffect(() => {
    let active = true
    if (request.current.attempt !== attempt) {
      request.current = {
        attempt,
        promise: loadTemplateAndPdf({
          document,
          template: initialTemplate.current,
          analyze,
          download: downloadReleasePdf,
          onStep: setStep,
        }).then(async (result) => ({
          ...result,
          // Without the Job's Phases the review still works; it only cannot
          // offer them.
          jobPhases: await listJobPhases(job.id).catch(() => []),
        })),
      }
    }

    request.current.promise.then(
      (result) => { if (active) setLoaded((current) => current ?? result) },
      (error) => { if (active) setLoadError(error.message) },
    )
    return () => {
      active = false
    }
  }, [analyze, attempt, document, job.id])

  const retry = () => {
    initialTemplate.current = null
    setLoadError(null)
    setLoaded(null)
    setStep('analyzing')
    setAttempt((current) => current + 1)
  }

  const handleConfirm = async (input) => {
    await templateState.confirm(input)
    onClose()
  }

  const handleReanalyze = async () => {
    const template = await analyze(document, { force: true })
    setLoaded((current) => ({ ...current, template }))
  }

  const status = loaded ? describeTemplateStatus(loaded.template) : null
  const jobCode = job.code ?? job.id

  return (
    <Dialog
      open
      fullScreen
      onClose={onClose}
      aria-labelledby="payment-schedule-title"
    >
      <DialogTitle
        id="payment-schedule-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 1.5 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="span" variant="h6" fontWeight={850} sx={{ display: 'block' }}>
            Payment Schedule
          </Typography>
          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            noWrap
            sx={{ display: 'block' }}
          >
            {position ? `Document ${position.index} of ${position.total} · ` : ''}
            Job #{jobCode} · {document.name}
          </Typography>
        </Box>
        {status && <Chip size="small" color={status.color} label={status.label} />}
        <IconButton aria-label="Close" onClick={onClose}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>

      {!loaded && !loadError && (
        <Waiting title={step === 'analyzing' ? 'Analyzing the PDF…' : 'Opening the PDF…'}>
          {step === 'analyzing'
            ? 'Finding the Lots and draws of the schedule. This takes a few seconds.'
            : 'Loading the pages so you can check the amounts.'}
        </Waiting>
      )}

      {loadError && (
        <>
          <DialogContent dividers>
            <Alert severity="error" sx={{ maxWidth: 640, mx: 'auto', mt: 2 }}>
              {loadError}
            </Alert>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 1.5 }}>
            <Button onClick={onClose}>Close</Button>
            <Button variant="contained" onClick={retry}>Try again</Button>
          </DialogActions>
        </>
      )}

      {loaded && (
        <Suspense fallback={<Waiting title="Opening the PDF…" />}>
          <PaymentScheduleEditor
            key={loaded.template.updatedAt}
            template={loaded.template}
            file={loaded.file}
            jobPhases={loaded.jobPhases}
            canManage={canManage}
            onConfirm={handleConfirm}
            onReanalyze={handleReanalyze}
            onClose={onClose}
          />
        </Suspense>
      )}
    </Dialog>
  )
}
