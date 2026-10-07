import { useEffect, useRef, useState } from 'react'
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
import {
  describeTemplateStatus,
} from '../services/releaseTemplateRecord.js'
import { downloadReleasePdf } from '../services/releaseTemplateRepository.js'
import ReleaseTemplateEditor from './ReleaseTemplateEditor.jsx'

/**
 * Opens a RELEASE document as a template. When it has not been analyzed (or the
 * last analysis failed) it analyzes first, then shows the PDF with the
 * suggested boxes so the reviewer can adjust and confirm.
 */
export default function ReleaseTemplateReviewDialog({
  job,
  document,
  templateState,
  canManage,
  onClose,
}) {
  const [loaded, setLoaded] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [step, setStep] = useState('analyzing')
  // The template as it was when the dialog opened; later updates arrive through
  // `loaded`, so the opening effect does not depend on changing state.
  const initialTemplate = useRef(templateState.templatesByDocumentId[document.id] ?? null)
  const { analyze } = templateState

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        let template = initialTemplate.current
        const reusable = template && ['needs_review', 'confirmed', 'superseded'].includes(template.status)
        if (!reusable) {
          template = await analyze(document, {})
        }
        if (!cancelled) setStep('loading-pdf')

        const file = await downloadReleasePdf(document)
        if (!cancelled) setLoaded({ template, file })
      } catch (error) {
        if (!cancelled) setLoadError(error.message)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [analyze, attempt, document])

  const retry = () => {
    // A retry starts from the stored state, so a failed run is analyzed again.
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
      aria-labelledby="release-template-title"
    >
      <DialogTitle
        id="release-template-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 1.5 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="span" variant="h6" fontWeight={850} sx={{ display: 'block' }}>
            Release template
          </Typography>
          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            noWrap
            sx={{ display: 'block' }}
          >
            Job #{jobCode} · {document.name}
          </Typography>
        </Box>
        {status && <Chip size="small" color={status.color} label={status.label} />}
        <IconButton aria-label="Close" onClick={onClose}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>

      {!loaded && !loadError && (
        <DialogContent dividers sx={{ display: 'grid', placeItems: 'center' }}>
          <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <CircularProgress />
            <Typography fontWeight={750}>
              {step === 'analyzing' ? 'Analyzing the PDF…' : 'Opening the PDF…'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
              {step === 'analyzing'
                ? 'Detecting the Release type and where the values go. This takes a few seconds.'
                : 'Loading the pages so you can place the boxes.'}
            </Typography>
          </Stack>
        </DialogContent>
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
        <ReleaseTemplateEditor
          key={loaded.template.updatedAt}
          template={loaded.template}
          file={loaded.file}
          canManage={canManage}
          onConfirm={handleConfirm}
          onReanalyze={handleReanalyze}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}
