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
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import { loadTemplateAndPdf } from '../../release-templates/services/releaseTemplateLoader.js'
import { downloadReleasePdf } from '../../release-templates/services/releaseTemplateRepository.js'
import { listJobLots, listJobPhases } from '../services/paymentScheduleRepository.js'
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
  // { message, reason, aiAvailable }: reason 'unrecognized_layout' means no parser knows it.
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  // The attempt the person asked to read with AI, if any.
  const [aiAttempt, setAiAttempt] = useState(null)
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
      const withAi = aiAttempt === attempt
      request.current = {
        attempt,
        promise: (withAi
          ? analyze(document, { force: true, useAi: true })
          : Promise.resolve(initialTemplate.current)
        ).then((template) => loadTemplateAndPdf({
          document,
          template,
          analyze,
          download: downloadReleasePdf,
          onStep: setStep,
        })).then(async (result) => ({
          ...result,
          // Without the Job's Phases the review still works; it only cannot
          // offer them.
          jobPhases: await listJobPhases(job.id).catch(() => []),
          // The Lots tell the Phase of a schedule that prints none.
          jobLots: await listJobLots(job.id).catch(() => []),
        })),
      }
    }

    request.current.promise.then(
      (result) => { if (active) setLoaded((current) => current ?? result) },
      (error) => {
        if (active) {
          setLoadError({
            message: error.message,
            reason: error.reason ?? null,
            aiAvailable: error.aiAvailable === true,
          })
        }
      },
    )
    return () => {
      active = false
    }
  }, [aiAttempt, analyze, attempt, document, job.id])

  const retry = ({ withAi = false } = {}) => {
    initialTemplate.current = null
    setLoadError(null)
    setLoaded(null)
    setStep(withAi ? 'reading-with-ai' : 'analyzing')
    setAiAttempt(withAi ? attempt + 1 : null)
    setAttempt((current) => current + 1)
  }
  // Only when no parser knows the layout, the server can call the AI, and the person can
  // change the schedule.
  const canReadWithAi = canManage
    && loadError?.reason === 'unrecognized_layout'
    && loadError.aiAvailable

  const handleConfirm = async (input) => {
    await templateState.confirm(input)
    onClose()
  }

  const handleReanalyze = async () => {
    // A schedule the AI read is read with AI again: no parser knows its layout.
    const useAi = Boolean(loaded?.template?.ai)
    const template = await analyze(document, { force: true, useAi })
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
        <Waiting
          title={{
            analyzing: 'Analyzing the PDF…',
            'reading-with-ai': 'Reading the PDF with AI…',
          }[step] ?? 'Opening the PDF…'}
        >
          {{
            analyzing: 'Finding the Lots and draws of the schedule. This takes a few seconds.',
            'reading-with-ai': 'The AI is finding the Lots and draws, then every amount is checked '
              + 'against the PDF and this Job. This can take a minute or two.',
          }[step] ?? 'Loading the pages so you can check the amounts.'}
        </Waiting>
      )}

      {loadError && (
        <>
          <DialogContent dividers>
            <Stack spacing={2} sx={{ maxWidth: 640, mx: 'auto', mt: 2 }}>
              <Alert severity="error">{loadError.message}</Alert>
              {canReadWithAi && (
                <Alert severity="info" icon={<AutoAwesomeRoundedIcon />}>
                  <Typography variant="body2" fontWeight={750} gutterBottom>
                    Read this layout with AI
                  </Typography>
                  <Typography variant="body2">
                    The AI gets the text of this PDF and this Job&apos;s draws, Lots, Plans and
                    prices (sent to Mistral), and points at the amount of each Lot and draw. Every
                    amount is then checked against the PDF and the Job: the price of each Plan, the
                    Billing Setup percentages and the Utility split by Phase. Nothing is used until
                    you check the highlights and confirm.
                  </Typography>
                </Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 1.5 }}>
            <Button onClick={onClose}>Close</Button>
            <Button
              variant={canReadWithAi ? 'text' : 'contained'}
              onClick={() => retry()}
            >
              Try again
            </Button>
            {canReadWithAi && (
              <Button
                variant="contained"
                startIcon={<AutoAwesomeRoundedIcon />}
                onClick={() => retry({ withAi: true })}
              >
                Read it with AI
              </Button>
            )}
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
            jobLots={loaded.jobLots}
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
