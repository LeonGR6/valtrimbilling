import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { packageDocumentNumber } from '../../draw-invoice/utils/packageInvoiceLabel.js'
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
  FormControlLabel,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import PdfPreviewDialog from '../../release-templates/components/PdfPreviewDialog.jsx'
import { downloadStoredPdf } from '../../release-templates/services/packageReleaseRepository.js'
import {
  buildPackageScheduleFileName,
  describeDifference,
  describeOver,
  describeRepeated,
  describeSchedulePlan,
  describeUnmatchedLine,
  listEarlierPackages,
  matchPackageToSchedules,
  packageScheduleLines,
  summarizeSources,
} from '../services/packageSchedule.js'
import { formatMoney } from '../services/paymentScheduleRecord.js'
import {
  listConfirmedJobSchedules,
  listPackagePaymentSchedules,
  savePackagePaymentSchedule,
} from '../services/packageScheduleRepository.js'

const LIST_LIMIT = 8

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

function ShortList({ title, items }) {
  const shown = items.slice(0, LIST_LIMIT)
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={850}>{title}</Typography>
      <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2.5 }}>
        {shown.map((text) => (
          <Typography key={text} component="li" variant="body2">{text}</Typography>
        ))}
      </Stack>
      {items.length > shown.length && (
        <Typography variant="caption" color="text.secondary">
          and {items.length - shown.length} more.
        </Typography>
      )}
    </Box>
  )
}

const NO_PACKAGES = []

/**
 * Highlights, on the Job's Payment Schedule, the amounts this Package bills,
 * saves the result as a Package document and downloads it. A Lot / draw is
 * found in the schedule by Phase, Lot and draw; amounts that differ and Lots
 * the schedule does not list are shown before generating.
 *
 * A matrix schedule also has its "Previously Invoiced" and "This Request" rows
 * filled: this Package's amounts per draw, and those of the Job's earlier
 * Packages, which can be taken out one by one.
 */
export default function GeneratePackageScheduleDialog({
  packageRecord,
  job,
  packages = NO_PACKAGES,
  // Inside the combined Package dialog: only the content, no frame or buttons. The
  // parent generates through `ref` and learns whether it can through `onReadyChange`.
  embedded = false,
  // The parent has its own Preview button and calls `showPreview` through `ref`.
  hideInlinePreview = false,
  ref = null,
  onReadyChange = null,
  onClose,
}) {
  const [attempt, setAttempt] = useState(0)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false)
  // Earlier Packages the person took out of "Previously Invoiced".
  const [leftOut, setLeftOut] = useState(() => new Set())
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
          listConfirmedJobSchedules(job.id),
          listPackagePaymentSchedules(packageRecord.id),
        ]).then(([templates, existing]) => ({ templates, existing })),
      }
    }

    request.current.promise.then(
      (loaded) => { if (active) setData(loaded) },
      (loadingError) => { if (active) setLoadError(loadingError.message) },
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

  // A Retention Release and a Price Adjustment bill no Lot or Draw of the schedule.
  const isRetention = (packageRecord.packageType ?? 'DRAW') !== 'DRAW'
  const isPriceAdjustment = packageRecord.packageType === 'PRICE_ADJUSTMENT'
  const lines = packageScheduleLines(packageRecord)
  const plan = data ? matchPackageToSchedules(lines, data.templates) : null
  const summary = plan ? describeSchedulePlan(plan, lines.length) : null
  const existing = data?.existing[0] ?? null
  // True while anything is being built, so the controls stay still.
  const generating = status !== 'idle'
  const buildingFile = status === 'generating'

  // Previously Invoiced: the earlier Packages that count, against the same schedules.
  const earlierPackages = listEarlierPackages(packageRecord, packages)
  const earlierPlans = data
    ? earlierPackages
      .filter(({ id }) => !leftOut.has(id))
      .map((earlier) => ({
        id: earlier.id,
        number: packageDocumentNumber(earlier),
        plan: matchPackageToSchedules(packageScheduleLines(earlier), data.templates),
      }))
    : []
  const summaries = plan ? summarizeSources(plan, earlierPlans) : []
  const withoutSummaryRows = plan
    ? plan.sources.filter(({ template }) => (
      template.layout === 'matrix' && !template.mapping?.summaryRows
    ))
    : []
  const summaryWarnings = summaries.reduce(
    (count, item) => count + item.repeated.length + item.over.length,
    0,
  )
  const needsAcknowledgement = (summary?.warnings ?? 0) + summaryWarnings > 0

  const toggleLeftOut = (id) => {
    setLeftOut((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const ready = Boolean(summary?.canGenerate) && !isRetention

  // Highlights and fills the schedules for this Package and returns the file.
  // Nothing is saved.
  const build = async () => {
    const sources = []
    for (const source of plan.sources) {
      const pdf = await downloadStoredPdf(source.template.pdf)
      sources.push({
        pdfBytes: new Uint8Array(await pdf.arrayBuffer()),
        cells: source.cells,
        fills: summaries.find((item) => item.template === source.template)?.fills ?? [],
        fillBoxes: summaries.find((item) => item.template === source.template)?.fillBoxes ?? [],
      })
    }

    // The PDF library is only loaded when a Payment Schedule is generated.
    const { buildPackageSchedulePdf } = await import('../services/packageSchedulePdf.js')
    const { bytes, highlighted, filled, replaced } = await buildPackageSchedulePdf(sources)

    const fileName = buildPackageScheduleFileName({
      jobCode: job.code,
      packageNumber: packageDocumentNumber(packageRecord),
    })
    return { bytes, fileName, highlighted, filled, replaced }
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
      const { bytes, fileName, highlighted, filled, replaced } = await build()
      await savePackagePaymentSchedule({ packageId: packageRecord.id, fileName, bytes })
      if (download) saveToDisk(new Blob([bytes], { type: 'application/pdf' }), fileName)

      setSaved({ fileName, highlighted, filled, replaced, downloaded: download })
      listPackagePaymentSchedules(packageRecord.id)
        .then((next) => setData((current) => ({ ...current, existing: next })))
        .catch(() => {})
      return { bytes, fileName }
    } catch (generationError) {
      setError(generationError.message)
      return null
    } finally {
      setStatus('idle')
    }
  }

  const downloadExisting = async () => {
    try {
      saveToDisk(await downloadStoredPdf(existing.file), existing.file.name)
    } catch (downloadError) {
      setError(downloadError.message)
    }
  }

  const canGenerate = ready && (!needsAcknowledgement || acknowledged)

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
        : isRetention
          ? 'retention'
          : data && data.templates.length === 0
            ? 'missing_template'
            : data && !summary?.canGenerate
              ? 'unmatched'
              : needsAcknowledgement && !acknowledged ? 'acknowledge' : null,
      // Changes whenever the generated file would change.
      signature: JSON.stringify([[...leftOut]]),
    })
  }, [
    acknowledged,
    canGenerate,
    data,
    generating,
    isRetention,
    leftOut,
    loadError,
    needsAcknowledgement,
    onReadyChange,
    status,
    summary?.canGenerate,
  ])

  const body = (
    <>
        {!data && !loadError && (
          <Stack spacing={1.5} sx={{ alignItems: 'center', py: 5 }}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">
              Loading the Job's Payment Schedules…
            </Typography>
          </Stack>
        )}

        {loadError && (
          <Alert severity="error" action={<Button color="inherit" onClick={retry}>Retry</Button>}>
            {loadError}
          </Alert>
        )}

        {data && isRetention && (
          <Alert severity="info">
            {isPriceAdjustment ? 'This Package is a Price Adjustment' : 'This Package is a Retention Release'}.
            It bills no Lot or draw of the schedule, so there is nothing to highlight.
          </Alert>
        )}

        {data && !isRetention && data.templates.length === 0 && (
          <Alert severity="warning">
            This Job has no confirmed Payment Schedule. Upload it in the Documents section
            (Payment Schedules) and confirm it, then generate this again.
          </Alert>
        )}

        {data && !isRetention && data.templates.length > 0 && !summary.canGenerate && (
          <Stack spacing={1.5}>
            <Alert severity="warning">
              None of the Lots and draws of this Package are in the Job's Payment Schedules.
              Check that the Phase of each schedule is set to the right Phase of the Job.
            </Alert>
            {plan.unmatched.length > 0 && (
              <ShortList
                title="Not found in the schedules"
                items={plan.unmatched.map(describeUnmatchedLine)}
              />
            )}
          </Stack>
        )}

        {ready && (
          <Stack spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">Will be highlighted</Typography>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.25 }}>
                <Chip color="success" label={`${summary.highlighted} of ${summary.lineCount} amounts`} />
                {plan.sources.map((source) => (
                  <Chip
                    key={source.template.id}
                    variant="outlined"
                    label={`${source.template.pdf.name} · ${source.cells.length}`}
                  />
                ))}
              </Stack>
              {plan.sources.length > 1 && (
                <Typography variant="caption" color="text.secondary">
                  The schedules are put one after the other in a single PDF.
                </Typography>
              )}
            </Box>

            {plan.differing.length > 0 && (
              <Alert severity="warning">
                <ShortList
                  title="The amount differs from the schedule"
                  items={plan.differing.map(describeDifference)}
                />
              </Alert>
            )}

            {plan.unmatched.length > 0 && (
              <Alert severity="warning">
                <ShortList
                  title="Not found in the schedules, so not highlighted"
                  items={plan.unmatched.map(describeUnmatchedLine)}
                />
              </Alert>
            )}

            {withoutSummaryRows.length > 0 && (
              <Alert severity="info">
                {withoutSummaryRows.map(({ template }) => template.pdf.name).join(', ')}{' '}
                {withoutSummaryRows.length === 1 ? 'was' : 'were'} confirmed before its
                "Previously Invoiced" and "This Request" rows could be filled. To fill
                them, open {withoutSummaryRows.length === 1 ? 'it' : 'each'} in Documents →
                Payment Schedules, review it and save it again.
              </Alert>
            )}

            {summaries.length > 0 && (
              <Box>
                <Typography variant="subtitle2" fontWeight={850}>
                  Previously Invoiced and This Request
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  What each draw billed before this Package, and what this Package bills.
                  A draw with nothing billed is left blank.
                </Typography>

                {earlierPackages.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    This Job has no earlier Package, so nothing was invoiced before.
                  </Typography>
                ) : (
                  <Stack sx={{ mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Earlier Packages counted as already invoiced. Uncheck one to leave it out.
                    </Typography>
                    {earlierPackages.map((earlier) => (
                      <FormControlLabel
                        key={earlier.id}
                        disabled={generating}
                        control={(
                          <Checkbox
                            size="small"
                            checked={!leftOut.has(earlier.id)}
                            onChange={() => toggleLeftOut(earlier.id)}
                          />
                        )}
                        label={(
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                            <Typography variant="body2" fontWeight={700}>
                              {packageDocumentNumber(earlier)}
                            </Typography>
                            <Chip size="small" variant="outlined" label={earlier.status} />
                          </Stack>
                        )}
                      />
                    ))}
                  </Stack>
                )}

                {summaries.map((item) => (
                  <Box key={item.template.id} sx={{ mb: 1 }}>
                    {summaries.length > 1 && (
                      <Typography variant="caption" fontWeight={700}>{item.template.pdf.name}</Typography>
                    )}
                    <Table size="small" aria-label="Amounts per draw">
                      <TableHead>
                        <TableRow>
                          <TableCell>Draw</TableCell>
                          <TableCell align="right">Previously (net)</TableCell>
                          <TableCell align="right">This request (net)</TableCell>
                          <TableCell align="right">Schedule</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {item.draws.map((row) => (
                          <TableRow key={row.draw}>
                            <TableCell>{row.draw}</TableCell>
                            <TableCell align="right">{row.previously > 0 ? formatMoney(row.previously) : '—'}</TableCell>
                            <TableCell align="right">{row.request > 0 ? formatMoney(row.request) : '—'}</TableCell>
                            <TableCell
                              align="right"
                              sx={row.over ? { color: 'warning.main', fontWeight: 700 } : undefined}
                            >
                              {formatMoney(row.contract)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                ))}

                {summaries.some((item) => item.over.length > 0) && (
                  <Alert severity="warning" sx={{ mb: 1 }}>
                    <ShortList
                      title="More than the schedule holds"
                      items={summaries.flatMap((item) => item.over.map(describeOver))}
                    />
                  </Alert>
                )}
                {summaries.some((item) => item.repeated.length > 0) && (
                  <Alert severity="warning">
                    <ShortList
                      title="Already billed by an earlier Package"
                      items={summaries.flatMap((item) => item.repeated.map(describeRepeated))}
                    />
                  </Alert>
                )}
              </Box>
            )}

            {needsAcknowledgement && (
              <FormControlLabel
                disabled={generating}
                control={(
                  <Checkbox
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                )}
                label="I checked these differences and want to generate it anyway"
              />
            )}

            {existing && !saved && (
              <Alert severity="info">
                A Payment Schedule was already generated on {formatStamp(existing.completedAt)}.
                Generating again replaces it.
              </Alert>
            )}
          </Stack>
        )}

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {saved && (
          <Alert severity="success" icon={<TaskAltRoundedIcon />} sx={{ mt: 2 }}>
            {saved.highlighted} {saved.highlighted === 1 ? 'amount' : 'amounts'} highlighted
            {saved.filled > 0 ? ` and ${saved.filled} ${saved.filled === 1 ? 'value' : 'values'} filled` : ''}
            {saved.replaced > 0 ? ` (${saved.replaced} typed ${saved.replaced === 1 ? 'value' : 'values'} replaced)` : ''}.
            {' '}Saved to this Package{saved.downloaded ? ' and downloaded' : ''} as “{saved.fileName}”.
          </Alert>
        )}

        {existing && (
          <>
            <Divider sx={{ my: 2.25 }} />
            <Typography variant="subtitle2" fontWeight={850} sx={{ mb: 1 }}>
              Saved for this Package
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700} noWrap title={existing.file.name}>
                  {existing.file.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatStamp(existing.completedAt)}
                </Typography>
              </Box>
              <IconButton
                size="small"
                aria-label={`Download ${existing.file.name}`}
                onClick={downloadExisting}
              >
                <DownloadRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          </>
        )}
    </>
  )

  const previewDialog = preview && (
    <PdfPreviewDialog
      title="Payment Schedule"
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
      aria-labelledby="generate-schedule-title"
    >
      <DialogTitle id="generate-schedule-title">
        Generate Payment Schedule
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
          disabled={!ready || generating || (needsAcknowledgement && !acknowledged)}
          onClick={() => generate()}
        >
          {buildingFile ? 'Generating…' : existing ? 'Generate again' : 'Generate and download'}
        </Button>
      </DialogActions>
      {previewDialog}
    </Dialog>
  )
}
