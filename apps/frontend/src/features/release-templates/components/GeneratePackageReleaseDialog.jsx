import { useEffect, useRef, useState } from 'react'
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
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import {
  buildPackageFillValues,
  buildPackageReleaseFileName,
  describeFillPlan,
  pickDefaultTemplate,
  sortTemplatesByType,
} from '../services/packageRelease.js'
import {
  downloadStoredPdf,
  getPackageReleaseValues,
  listConfirmedJobTemplates,
  listPackageReleases,
  savePackageRelease,
} from '../services/packageReleaseRepository.js'
import { getReleaseVariable, releaseTypeLabel } from '../services/releaseTemplateRecord.js'

const HELPER_TEXT = {
  through_date: (values) => values.cutoffSource === 'builder_setup'
    ? "Cut-off date of this Package, from the Builder's setup."
    : 'The Builder bills on any date, so the Package date is used.',
  check_amount: () => 'Invoice net amount, after retention and wrap.',
  signature_date: () => 'Same date as Through Date.',
}

function formatStamp(value) {
  return value
    ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : ''
}

function saveToDisk(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// What the Package supplies, as the text of the inputs.
function startingForm(values) {
  const fill = buildPackageFillValues(values)
  return {
    through_date: fill.through_date,
    check_amount: fill.check_amount === '' ? '' : String(fill.check_amount),
    signature_date: fill.signature_date,
  }
}

/**
 * Fills the Job's Release template for a Package, saves the result as a Package
 * document and downloads it. Values come from the Package; they are shown and
 * can be corrected before generating.
 */
export default function GeneratePackageReleaseDialog({ packageRecord, job, onClose }) {
  const [attempt, setAttempt] = useState(0)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [templateId, setTemplateId] = useState('')
  const [form, setForm] = useState({ through_date: '', check_amount: '', signature_date: '' })
  const [signatureFollows, setSignatureFollows] = useState(true)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const request = useRef({ attempt: null, promise: null })

  useEffect(() => {
    let active = true
    // One request per attempt: a repeated run of this effect shares it.
    if (request.current.attempt !== attempt) {
      request.current = {
        attempt,
        promise: Promise.all([
          getPackageReleaseValues(packageRecord.id),
          listConfirmedJobTemplates(job.id),
          listPackageReleases(packageRecord.id),
        ]).then(([values, templates, releases]) => ({
          values,
          templates: sortTemplatesByType(templates),
          releases,
        })),
      }
    }

    request.current.promise.then(
      (loaded) => {
        if (!active) return
        setData(loaded)
        setForm(startingForm(loaded.values))
        setTemplateId(pickDefaultTemplate(loaded.templates)?.id ?? '')
      },
      (loadingError) => {
        if (active) setLoadError(loadingError.message)
      },
    )
    return () => {
      active = false
    }
  }, [attempt, job.id, packageRecord.id])

  const retry = () => {
    setLoadError(null)
    setData(null)
    setAttempt((current) => current + 1)
  }

  const template = data?.templates.find((candidate) => candidate.id === templateId) ?? null
  const plan = describeFillPlan(template?.mapping)
  const existing = data?.releases.find(
    (release) => release.label === releaseTypeLabel(template?.releaseType),
  ) ?? null
  const generating = status === 'generating'

  const setValue = (key, value) => {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'through_date' && signatureFollows ? { signature_date: value } : {}),
    }))
  }

  const generate = async () => {
    setStatus('generating')
    setError(null)
    setSaved(null)
    try {
      const pdf = await downloadStoredPdf(template.pdf)
      // The PDF library is only loaded when a Release is generated.
      const { fillReleasePdf } = await import('../services/releasePdfFiller.js')
      const { bytes, skipped } = await fillReleasePdf({
        pdfBytes: new Uint8Array(await pdf.arrayBuffer()),
        mapping: template.mapping,
        // The three variables a Package fills; any other mapped one stays blank.
        values: form,
      })

      const fileName = buildPackageReleaseFileName({
        jobCode: job.code,
        packageNumber: packageRecord.packageNumber,
        releaseType: template.releaseType,
      })
      await savePackageRelease({
        packageId: packageRecord.id,
        releaseType: template.releaseType,
        fileName,
        bytes,
      })
      saveToDisk(new Blob([bytes], { type: 'application/pdf' }), fileName)

      setSaved({ fileName, skipped })
      listPackageReleases(packageRecord.id)
        .then((releases) => setData((current) => ({ ...current, releases })))
        .catch(() => {})
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setStatus('idle')
    }
  }

  const downloadExisting = async (release) => {
    try {
      saveToDisk(await downloadStoredPdf(release.file), release.file.name)
    } catch (downloadError) {
      setError(downloadError.message)
    }
  }

  const values = data?.values
  const hasTemplates = (data?.templates.length ?? 0) > 0

  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={generating ? undefined : onClose}
      aria-labelledby="generate-release-title"
    >
      <DialogTitle id="generate-release-title">
        Generate Release
        <Typography variant="body2" color="text.secondary">
          {packageRecord.packageNumber} · Job #{job.code}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {!data && !loadError && (
          <Stack spacing={1.5} sx={{ alignItems: 'center', py: 5 }}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">
              Loading the Package values and the Job's templates…
            </Typography>
          </Stack>
        )}

        {loadError && (
          <Alert severity="error" action={<Button color="inherit" onClick={retry}>Retry</Button>}>
            {loadError}
          </Alert>
        )}

        {data && !hasTemplates && (
          <Alert severity="warning">
            This Job has no confirmed Release template. Upload a Release in the Job's
            documents and confirm its template first.
          </Alert>
        )}

        {data && hasTemplates && (
          <Stack spacing={2.25}>
            {data.templates.length > 1 ? (
              <TextField
                select
                size="small"
                label="Release type"
                value={templateId}
                disabled={generating}
                onChange={(event) => {
                  setTemplateId(event.target.value)
                  setSaved(null)
                }}
              >
                {data.templates.map((candidate) => (
                  <MenuItem key={candidate.id} value={candidate.id}>
                    {releaseTypeLabel(candidate.releaseType)}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <Box>
                <Typography variant="caption" color="text.secondary">Release type</Typography>
                <Typography fontWeight={750}>{releaseTypeLabel(template?.releaseType)}</Typography>
              </Box>
            )}

            {plan.filled.length > 0 && (
              <Stack spacing={1.5}>
                {plan.filled.map(({ key, label }) => {
                  const isDate = getReleaseVariable(key).kind === 'date'
                  return (
                    <TextField
                      key={key}
                      size="small"
                      label={label}
                      type={isDate ? 'date' : 'text'}
                      value={form[key]}
                      disabled={generating}
                      helperText={HELPER_TEXT[key](values)}
                      onChange={(event) => {
                        if (key === 'signature_date') setSignatureFollows(false)
                        setValue(key, event.target.value)
                      }}
                      slotProps={{
                        inputLabel: isDate ? { shrink: true } : undefined,
                        input: isDate
                          ? undefined
                          : { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                      }}
                    />
                  )
                })}
              </Stack>
            )}

            {plan.filled.some(({ key }) => key === 'check_amount') && values.netAmount !== null && (
              <Typography variant="caption" color="text.secondary">
                Invoice {values.invoiceNumber ? `${values.invoiceNumber}: ` : ''}
                Gross {formatCurrency(values.grossAmount ?? 0)} − Retention{' '}
                {formatCurrency(values.retentionAmount ?? 0)} − Wrap{' '}
                {formatCurrency(values.wrapAmount ?? 0)} = Net {formatCurrency(values.netAmount)}
              </Typography>
            )}

            {values.netAmount === null && plan.filled.some(({ key }) => key === 'check_amount') && (
              <Alert severity="warning">
                This Package has no invoice amount. Type the check amount or it stays blank.
              </Alert>
            )}

            {plan.missingFromForm.length > 0 && (
              <Alert severity="info">
                This form has no {plan.missingFromForm.map(({ label }) => label).join(' or ')}, so
                {' '}{plan.missingFromForm.length > 1 ? 'they are' : 'it is'} not filled.
              </Alert>
            )}
            {plan.blank.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                Left blank for now: {plan.blank.map(({ label }) => label).join(', ')}.
                The signature is never filled.
              </Typography>
            )}

            {existing && !saved && (
              <Alert severity="info">
                A Release of this type was already generated on {formatStamp(existing.completedAt)}.
                Generating again replaces it.
              </Alert>
            )}
          </Stack>
        )}

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {saved && (
          <Alert severity="success" icon={<TaskAltRoundedIcon />} sx={{ mt: 2 }}>
            Saved to this Package and downloaded as “{saved.fileName}”.
          </Alert>
        )}

        {data?.releases.length > 0 && (
          <>
            <Divider sx={{ my: 2.25 }} />
            <Typography variant="subtitle2" fontWeight={850} sx={{ mb: 1 }}>
              Releases saved for this Package
            </Typography>
            <Stack spacing={0.75}>
              {data.releases.map((release) => (
                <Stack key={release.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap title={release.file.name}>
                      {release.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {release.file.name} · {formatStamp(release.completedAt)}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    aria-label={`Download ${release.file.name}`}
                    onClick={() => downloadExisting(release)}
                  >
                    <DownloadRoundedIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={generating}>Close</Button>
        <Button
          variant="contained"
          startIcon={generating ? <CircularProgress size={18} color="inherit" /> : <DownloadRoundedIcon />}
          disabled={!data || !hasTemplates || !template || generating}
          onClick={generate}
        >
          {generating ? 'Generating…' : existing ? 'Generate again' : 'Generate and download'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
