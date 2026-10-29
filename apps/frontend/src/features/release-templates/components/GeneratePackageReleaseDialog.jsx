import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { displayInvoiceNumber, packageDocumentNumber } from '../../draw-invoice/utils/packageInvoiceLabel.js'
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
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import PdfPreviewDialog from './PdfPreviewDialog.jsx'
import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import {
  buildExceptionFillValues,
  buildExceptionRows,
  buildFinalReleaseNote,
  buildPackageFillValues,
  buildPackageReleaseFileName,
  newManualExceptionRow,
  describeFillPlan,
  chooseRelease,
  describePendingPackage,
} from '../services/packageRelease.js'
import {
  downloadStoredPdf,
  getPackageReleaseValues,
  listConfirmedJobTemplates,
  listPackageReleases,
  savePackageRelease,
} from '../services/packageReleaseRepository.js'
import { getReleaseVariable, releaseTypeLabel } from '../services/releaseTemplateRecord.js'
import { formatReleaseValue, printedReleaseValues } from '../services/releaseValueFormat.js'
import { saveToDisk } from '../../../utils/downloadFile.js'

// The three values a person can correct before generating. The two Exceptions
// lines are edited as rows (one per unpaid earlier Package, or added by hand).
const EDITABLE_VARIABLES = ['through_date', 'check_amount', 'signature_date']

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
export default function GeneratePackageReleaseDialog({
  packageRecord,
  job,
  // Inside the combined Package dialog: only the content, no frame or buttons. The
  // parent generates through `ref` and learns whether it can through `onReadyChange`.
  embedded = false,
  // The Package list, to name the earlier Packages by their invoice number.
  packages = [],
  // The parent has its own Preview button and calls `showPreview` through `ref`.
  hideInlinePreview = false,
  ref = null,
  onReadyChange = null,
  onClose,
}) {
  const [attempt, setAttempt] = useState(0)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [form, setForm] = useState({ through_date: '', check_amount: '', signature_date: '' })
  const [signatureFollows, setSignatureFollows] = useState(true)
  // The Exceptions lines: one per unpaid earlier Package, plus any added by hand.
  const [exceptionRows, setExceptionRows] = useState([])
  const manualCount = useRef(0)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [preview, setPreview] = useState(null)
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
          templates,
          releases,
        })),
      }
    }

    request.current.promise.then(
      (loaded) => {
        if (!active) return
        setData(loaded)
        setForm(startingForm(loaded.values))
        setExceptionRows(buildExceptionRows(loaded.values))
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

  // The Release type is decided by the Package, never picked by hand.
  const choice = data ? chooseRelease(data.values, data.templates) : null
  const template = choice?.template ?? null
  const plan = describeFillPlan(template?.mapping)
  const existing = data?.releases.find(
    (release) => release.label === releaseTypeLabel(template?.releaseType),
  ) ?? null
  // True while anything is being built, so the controls stay still.
  const generating = status !== 'idle'
  const buildingFile = status === 'generating'
  const isFilled = (variable) => plan.filled.some(({ key }) => key === variable)
  const usesExceptions = isFilled('waiver_release_dates')
    || isFilled('unpaid_progress_amount')
    || isFilled('disputed_claims_amount')
  // The Progress form lists a date and an amount per invoice; the Final form
  // has one total, so only the amounts are asked for.
  const showExceptionDates = isFilled('waiver_release_dates')
  const formatOf = (key) => template?.mapping.fields.find((field) => field.variable === key)?.format
  const exceptionLines = buildExceptionFillValues(exceptionRows)
  const hasExceptionLines = exceptionLines.waiver_release_dates.length > 0
    || exceptionLines.unpaid_progress_amount.length > 0
    || exceptionLines.disputed_claims_amount !== ''

  // An earlier Package is named by its invoice number once it has one.
  const labelOfEarlier = (item) => {
    const record = packages.find((candidate) => String(candidate.id) === String(item.id))
    return record ? packageDocumentNumber(record) : item.number
  }

  const updateExceptionRow = (key, changes) => {
    setExceptionRows((current) => current.map((row) => (
      row.key === key ? { ...row, ...changes } : row
    )))
  }

  const addExceptionRow = () => {
    manualCount.current += 1
    setExceptionRows((current) => [
      ...current,
      newManualExceptionRow(`manual-${manualCount.current}`),
    ])
  }

  const removeExceptionRow = (key) => {
    setExceptionRows((current) => current.filter((row) => row.key !== key))
  }

  const resetExceptionRows = () => {
    setExceptionRows(buildExceptionRows(data.values))
  }

  const setValue = (key, value) => {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'through_date' && signatureFollows ? { signature_date: value } : {}),
    }))
  }

  // Fills the template for this Package and returns the file. Nothing is saved.
  const build = async () => {
    const pdf = await downloadStoredPdf(template.pdf)
    // The PDF library is only loaded when a Release is generated.
    const { fillReleasePdf } = await import('../services/releasePdfFiller.js')
    const { bytes, skipped } = await fillReleasePdf({
      pdfBytes: new Uint8Array(await pdf.arrayBuffer()),
      mapping: template.mapping,
      values: {
        ...form,
        // One date and one amount per unpaid earlier Package that is included.
        waiver_release_dates: exceptionLines.waiver_release_dates,
        unpaid_progress_amount: exceptionLines.unpaid_progress_amount,
        disputed_claims_amount: exceptionLines.disputed_claims_amount,
      },
      // A Final says what it is final for, from the Builder setup.
      footerNote: choice.isFinal
        ? buildFinalReleaseNote({
          scope: data.values.finalRelease.scope,
          closing: choice.closing,
          jobCode: job.code,
        })
        : null,
    })

    const fileName = buildPackageReleaseFileName({
      jobCode: job.code,
      packageNumber: packageDocumentNumber(packageRecord),
      releaseType: template.releaseType,
    })
    return { bytes, fileName, skipped }
  }

  // Builds the file and shows it; nothing is saved.
  const showPreview = async () => {
    setStatus('previewing')
    setError(null)
    try {
      setPreview(await build())
    } catch (previewError) {
      setError(previewError.message)
    } finally {
      setStatus('idle')
    }
  }

  // Returns the saved file, or null when it failed (the error is shown).
  const generate = async ({ download = true } = {}) => {
    setStatus('generating')
    setError(null)
    setSaved(null)
    try {
      const { bytes, fileName, skipped } = await build()
      await savePackageRelease({
        packageId: packageRecord.id,
        releaseType: template.releaseType,
        fileName,
        bytes,
      })
      if (download) saveToDisk(new Blob([bytes], { type: 'application/pdf' }), fileName)

      setSaved({ fileName, skipped, downloaded: download })
      listPackageReleases(packageRecord.id)
        .then((releases) => setData((current) => ({ ...current, releases })))
        .catch(() => {})
      return { bytes, fileName }
    } catch (generationError) {
      setError(generationError.message)
      return null
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
  const ready = choice?.state === 'ready'

  const canGenerate = ready

  useImperativeHandle(ref, () => ({ generate, build, showPreview }))
  useEffect(() => {
    onReadyChange?.({
      canGenerate,
      generating,
      previewing: status === 'previewing',
      loading: !data && !loadError,
      // Why it cannot be generated, so the parent can offer a way to fix it.
      blocker: loadError
        ? 'error'
        : ['missing_template', 'retention', 'price_adjustment'].includes(choice?.state)
          ? choice.state
          : null,
      // Changes whenever the generated file would change.
      signature: JSON.stringify([form, exceptionRows]),
    })
  }, [canGenerate, choice?.state, data, exceptionRows, form, generating, loadError, onReadyChange, status])

  const body = (
    <>
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

        {choice?.state === 'retention' && (
          <Alert severity="info">
            This Package is a Retention Release. It has a Release only when the Builder setup
            releases retention at the level the Final Release is set to (Per Job with Per
            Project, or Per Building with Per Building), so there is none to generate here.
          </Alert>
        )}

        {choice?.state === 'price_adjustment' && (
          <Alert severity="info">
            This Package is a Price Adjustment. It bills no Lot or Draw, so it has no Release
            to generate.
          </Alert>
        )}

        {choice?.state === 'missing_template' && (
          <Alert severity="warning">
            {choice.isFinal
              ? `${choice.forRetention ? 'This Retention Release is' : 'This is'} the last Package of ${choice.closing.join(' and ')}, so it needs the Conditional Final Release, and this Job does not have one. Upload it in the Documents section (Releases) and confirm its template, then generate it again.`
              : 'This Job has no Conditional Progress Release. Upload it in the Documents section (Releases) and confirm its template, then generate it again.'}
          </Alert>
        )}

        {ready && (
          <Stack spacing={2.25}>
            <Box>
              <Typography variant="caption" color="text.secondary">Release type</Typography>
              <Typography fontWeight={750}>{releaseTypeLabel(template.releaseType)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {choice.isFinal
                  ? `${choice.forRetention ? 'Retention Release: last' : 'Last'} Package of ${choice.closing.join(' and ')}.`
                  : choice.retentionFinal
                    ? 'The Retention Release of this Job is the Conditional Final, so this Package uses the Progress form.'
                    : choice.scopeConfigured
                      ? 'This Package does not finish its Phase, Building or Project.'
                      : "The Builder's setup does not say where the Conditional Final Release applies, so the Progress form is used."}
              </Typography>
            </Box>

            {plan.filled.length > 0 && (
              <Stack spacing={1.5}>
                {plan.filled.filter(({ key }) => EDITABLE_VARIABLES.includes(key)).map(({ key, label }) => {
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

            {usesExceptions && (
              <Box>
                <Typography variant="subtitle2" fontWeight={850}>
                  Exceptions: unpaid earlier invoices
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  One line per unpaid Package of this Job from an earlier cut-off, filled with
                  its {showExceptionDates ? 'cut-off date and ' : ''}net amount.
                  {isFilled('disputed_claims_amount')
                    ? ' Their total goes in "Disputed claims for extras".'
                    : ''}{' '}
                  Edit any value, uncheck a line to leave it out, or add a line by hand.
                </Typography>

                {exceptionRows.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    There are no unpaid Packages from an earlier cut-off, so these lines print
                    N/A unless you add one.
                  </Typography>
                )}

                <Stack spacing={1.25}>
                  {exceptionRows.map((row) => {
                    const item = row.packageId === null
                      ? null
                      : values.pendingPackages.find(({ id }) => id === row.packageId)
                    return (
                      <Stack
                        key={row.key}
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Checkbox
                          size="small"
                          checked={row.include}
                          disabled={generating}
                          onChange={(event) => updateExceptionRow(row.key, { include: event.target.checked })}
                          slotProps={{ input: { 'aria-label': 'Include this line' } }}
                        />
                        <Box sx={{ minWidth: 96 }}>
                          <Typography variant="body2" fontWeight={700}>
                            {item ? labelOfEarlier(item) : 'Added by hand'}
                          </Typography>
                          {item && (
                            <Chip size="small" variant="outlined" label={describePendingPackage(item).workflowLabel} />
                          )}
                        </Box>
                        {showExceptionDates && (
                          <TextField
                            size="small"
                            type="date"
                            label="Date of Waiver and Release"
                            value={row.date}
                            disabled={generating || !row.include}
                            onChange={(event) => updateExceptionRow(row.key, { date: event.target.value })}
                            slotProps={{ inputLabel: { shrink: true } }}
                            sx={{ width: 190 }}
                          />
                        )}
                        <TextField
                          size="small"
                          label="Unpaid amount"
                          value={row.amount}
                          disabled={generating || !row.include}
                          onChange={(event) => updateExceptionRow(row.key, { amount: event.target.value })}
                          slotProps={{
                            input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                          }}
                          sx={{ width: 150 }}
                        />
                        {!item && (
                          <IconButton
                            size="small"
                            aria-label="Remove this line"
                            disabled={generating}
                            onClick={() => removeExceptionRow(row.key)}
                          >
                            <DeleteOutlineRoundedIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Stack>
                    )
                  })}
                </Stack>

                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button size="small" startIcon={<AddRoundedIcon />} disabled={generating} onClick={addExceptionRow}>
                    Add line
                  </Button>
                  <Button size="small" color="inherit" disabled={generating} onClick={resetExceptionRows}>
                    Restore from Packages
                  </Button>
                </Stack>

                {values.sameCutoffPackages.length > 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    Not listed, because they share this Package's cut-off date (
                    {formatReleaseValue('through_date', 'MM/DD/YYYY', values.cutoffDate)}
                    ): {values.sameCutoffPackages.map(({ number }) => number).join(', ')}.
                  </Typography>
                )}

                {hasExceptionLines && (
                  <Stack spacing={0.25} sx={{ mt: 1 }}>
                    {plan.filled.some(({ key }) => key === 'waiver_release_dates') && (
                      <Typography variant="body2">
                        <strong>Date(s) of Waiver and Release:</strong>{' '}
                        {printedReleaseValues('waiver_release_dates', formatOf('waiver_release_dates'), exceptionLines.waiver_release_dates)}
                      </Typography>
                    )}
                    {plan.filled.some(({ key }) => key === 'unpaid_progress_amount') && (
                      <Typography variant="body2">
                        <strong>Amount(s) of Unpaid Progress Payment(s):</strong>{' '}
                        {printedReleaseValues('unpaid_progress_amount', formatOf('unpaid_progress_amount'), exceptionLines.unpaid_progress_amount)}
                      </Typography>
                    )}
                    {isFilled('disputed_claims_amount') && (
                      <Typography variant="body2">
                        <strong>Disputed claims for extras:</strong>{' '}
                        {printedReleaseValues('disputed_claims_amount', formatOf('disputed_claims_amount'), exceptionLines.disputed_claims_amount)}
                      </Typography>
                    )}
                  </Stack>
                )}
              </Box>
            )}

            {plan.filled.some(({ key }) => key === 'check_amount') && values.netAmount !== null && (
              <Typography variant="caption" color="text.secondary">
                {(() => {
                  const invoiceNumber = values.invoiceNumber ?? displayInvoiceNumber(packageRecord)
                  return `Invoice ${invoiceNumber ? `${invoiceNumber}: ` : ''}`
                })()}
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
            <Typography variant="caption" color="text.secondary">
              {plan.blank.length > 0
                ? `Left blank for now: ${plan.blank.map(({ label }) => label).join(', ')}. `
                : ''}
              The signature is never filled.
            </Typography>

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
            Saved to this Package{saved.downloaded ? ' and downloaded' : ''} as “{saved.fileName}”.
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
    </>
  )

  const previewDialog = preview && (
    <PdfPreviewDialog
      title="Release"
      subtitle={preview.fileName}
      bytes={preview.bytes}
      confirmLabel={existing ? 'Generate again' : 'Generate and download'}
      onConfirm={canGenerate && !embedded
        ? () => {
          setPreview(null)
          generate()
        }
        : null}
      onClose={() => setPreview(null)}
    />
  )

  if (embedded) {
    return (
      <>
        {body}
        {ready && !hideInlinePreview && (
          <Button
            size="small"
            startIcon={status === 'previewing' ? <CircularProgress size={16} /> : <VisibilityRoundedIcon />}
            disabled={generating}
            onClick={showPreview}
            sx={{ mt: 1.5 }}
          >
            {status === 'previewing' ? 'Building preview…' : 'Preview'}
          </Button>
        )}
        {previewDialog}
      </>
    )
  }

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
        {body}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Box sx={{ mr: 'auto' }}>
          <Button
            startIcon={status === 'previewing' ? <CircularProgress size={16} /> : <VisibilityRoundedIcon />}
            disabled={!ready || generating}
            onClick={showPreview}
          >
            {status === 'previewing' ? 'Building preview…' : 'Preview'}
          </Button>
        </Box>
        <Button onClick={onClose} disabled={generating}>Close</Button>
        <Button
          variant="contained"
          startIcon={buildingFile ? <CircularProgress size={18} color="inherit" /> : <DownloadRoundedIcon />}
          disabled={!ready || generating}
          onClick={() => generate()}
        >
          {buildingFile ? 'Generating…' : existing ? 'Generate again' : 'Generate and download'}
        </Button>
      </DialogActions>
      {previewDialog}
    </Dialog>
  )
}
