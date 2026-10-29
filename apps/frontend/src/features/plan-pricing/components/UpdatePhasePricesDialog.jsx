import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  applyPhasePriceChanges,
  previewPhasePriceChanges,
} from '../services/phasePriceRepository.js'
import { workflowStatusLabel } from '../utils/priceDifferences.js'
import {
  affectedDraftPackages,
  affectedIssuedPackages,
  buildPhasePriceRequest,
  groupOptionChanges,
  groupPlanChanges,
  phaseEligibleChanges,
  summarizePhasePriceRequest,
  toPhasePriceChanges,
} from '../utils/phasePriceChanges.js'
import { plural } from '../../../utils/plural.js'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

function formatMoney(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? currencyFormatter.format(value)
    : 'Not priced'
}

function formatOption(price, notApplicable) {
  return notApplicable ? 'NA' : formatMoney(price)
}

function packageNumbers(packages) {
  return packages.map((item) => item.packageNumber).join(', ')
}

const VISIBLE_LINES = 3

// What would change in a Phase, one line per price: "Plan 2450  $240,000.00 → $245,000.00".
function phaseLines(phase, components) {
  const lines = []

  if (components.includePlan) {
    groupPlanChanges(phase).forEach((group) => {
      const where = `${plural(group.lotCount, 'lot')}${group.locked ? ' · in an invoiced Package' : ''}`
      if (group.baseChanged) {
        lines.push({
          key: `plan-${group.planCode}-${group.fromBase}-${group.toBase}-${group.locked}`,
          label: `Plan ${group.planCode}`,
          change: `${formatMoney(group.fromBase)} → ${formatMoney(group.toBase)}`,
          where,
        })
      }
      if (group.hardwareChanged) {
        lines.push({
          key: `hardware-${group.planCode}-${group.fromHardware}-${group.toHardware}-${group.locked}`,
          label: `Hardware of plan ${group.planCode}`,
          change: `${formatMoney(group.fromHardware)} → ${formatMoney(group.toHardware)}`,
          where,
        })
      }
    })
  }

  if (components.includeOptions) {
    groupOptionChanges(phase).forEach((group) => {
      lines.push({
        key: `option-${group.optionId}-${group.fromPrice}-${group.toPrice}-${group.locked}`,
        label: `Option ${group.code}`,
        change: `${formatOption(group.fromPrice, group.fromNotApplicable)} → ${formatOption(group.toPrice, group.toNotApplicable)}`,
        where: `${plural(group.lotCount, 'lot')}${group.locked ? ' · in an invoiced Package' : ''}`,
        description: group.description,
      })
    })
  }

  return lines
}

function PhaseChangeLines({ lines, expanded, onToggle }) {
  const visible = expanded ? lines : lines.slice(0, VISIBLE_LINES)
  const hidden = lines.length - visible.length

  return (
    <Stack spacing={0.5} sx={{ mt: 0.75 }}>
      {visible.map((line) => (
        <Box
          key={line.key}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'minmax(140px, 0.7fr) minmax(0, 1.3fr)' },
            columnGap: 2,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {line.label}
            {line.description && (
              <Typography component="span" variant="body2" color="text.secondary">
                {' '}· {line.description}
              </Typography>
            )}
          </Typography>
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {line.change}
            <Typography component="span" variant="body2" color="text.secondary">
              {' '}· {line.where}
            </Typography>
          </Typography>
        </Box>
      ))}
      {(hidden > 0 || (expanded && lines.length > VISIBLE_LINES)) && (
        <Box>
          <Button size="small" onClick={onToggle} sx={{ textTransform: 'none', ml: -1 }}>
            {expanded ? 'Show fewer' : `Show ${plural(hidden, 'more price')}`}
          </Button>
        </Box>
      )}
    </Stack>
  )
}

/**
 * Moves Phases created before a price change to today's price. The list comes from
 * the server; a reason is required. Packages that bill a chosen Phase are
 * recalculated when they are Drafts and keep their amount otherwise.
 *
 * `filter` narrows the list to what was just changed ({ planId, optionId,
 * components }); without it every Phase of the Job with an older price is listed.
 * `initialRows` is a list already looked up (for several changed prices at once)
 * and `loadRows` looks it up again.
 */
export default function UpdatePhasePricesDialog({
  job,
  filter = {},
  initialRows = null,
  loadRows = null,
  onClose,
  onApplied,
}) {
  const lockedComponents = filter.components && filter.components !== 'ALL'
    ? filter.components
    : null
  const [status, setStatus] = useState(initialRows ? 'ready' : 'loading')
  const [loadError, setLoadError] = useState(null)
  const [phases, setPhases] = useState(() => (initialRows ? toPhasePriceChanges(initialRows) : []))
  const [selected, setSelected] = useState([])
  const [expanded, setExpanded] = useState([])
  const [includePlan, setIncludePlan] = useState(lockedComponents !== 'OPTIONS')
  const [includeOptions, setIncludeOptions] = useState(lockedComponents !== 'PLAN')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [removeDocuments, setRemoveDocuments] = useState(false)

  const components = useMemo(
    () => ({ includePlan, includeOptions }),
    [includePlan, includeOptions],
  )

  useEffect(() => {
    // The list this dialog was opened with is still good until it is reloaded.
    if (initialRows && reloadKey === 0) return undefined

    let cancelled = false
    const request = loadRows
      ? loadRows()
      : previewPhasePriceChanges(job.id, {
        planId: filter.planId,
        optionId: filter.optionId,
        components: filter.components ?? 'ALL',
      })

    request
      .then((rows) => {
        if (cancelled) return
        setPhases(toPhasePriceChanges(rows))
        setSelected([])
        setLoadError(null)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setLoadError(error.message)
        setStatus('error')
      })

    return () => { cancelled = true }
  }, [job.id, filter.planId, filter.optionId, filter.components, initialRows, loadRows, reloadKey])

  const eligibleByPhase = useMemo(
    () => new Map(phases.map((phase) => [phase.phaseId, phaseEligibleChanges(phase, components)])),
    [phases, components],
  )
  const selectablePhaseIds = phases
    .filter((phase) => eligibleByPhase.get(phase.phaseId).count > 0)
    .map((phase) => phase.phaseId)
  const activeSelected = selected.filter((id) => selectablePhaseIds.includes(id))
  const summary = summarizePhasePriceRequest(phases, activeSelected, components)
  const draftPackages = affectedDraftPackages(phases, activeSelected, components)
  const issuedPackages = affectedIssuedPackages(phases, activeSelected, components)
  const documentsNeedRemoval = summary.packagesWithDocuments > 0
  const reasonValid = reason.trim().length >= 3 && reason.trim().length <= 500
  const canSubmit = !submitting
    && status === 'ready'
    && summary.lotCount + summary.optionCount > 0
    && reasonValid
    && (!documentsNeedRemoval || removeDocuments)

  const togglePhase = (phaseId) => {
    setSelected((current) => (
      current.includes(phaseId)
        ? current.filter((id) => id !== phaseId)
        : [...current, phaseId]
    ))
  }

  const toggleExpanded = (phaseId) => {
    setExpanded((current) => (
      current.includes(phaseId)
        ? current.filter((id) => id !== phaseId)
        : [...current, phaseId]
    ))
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const request = buildPhasePriceRequest(phases, activeSelected, components)
      const result = await applyPhasePriceChanges(job.id, {
        ...request,
        reason,
        removeDocuments: documentsNeedRemoval && removeDocuments,
      })
      await onApplied?.(result)
      onClose()
    } catch (error) {
      setSubmitError(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  const allSelected = selectablePhaseIds.length > 0
    && selectablePhaseIds.every((id) => activeSelected.includes(id))

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 700 }}>
        {filter.fromSave ? 'Update existing Phases?' : 'Update prices of existing Phases'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant="body2">
              {filter.fromSave
                ? 'Your new prices are saved and every new Phase will use them. These Phases were created earlier, so they still have the old prices.'
                : 'Each Phase keeps the price it had when it was created. Pick the Phases that should move to today\'s prices.'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Phases you leave unchecked keep their old price. You can update them later with
              &ldquo;Update existing Phases&rdquo;.
            </Typography>
          </Box>

          {status === 'loading' && (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 3, justifyContent: 'center' }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">Looking for Phases with an older price…</Typography>
            </Stack>
          )}

          {status === 'error' && (
            <Alert
              severity="error"
              action={(
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => {
                    setStatus('loading')
                    setReloadKey((key) => key + 1)
                  }}
                >
                  Retry
                </Button>
              )}
            >
              {loadError}
            </Alert>
          )}

          {status === 'ready' && phases.length === 0 && (
            <Alert severity="success">
              Every Phase already uses today&apos;s price.
            </Alert>
          )}

          {status === 'ready' && phases.length > 0 && (
            <>
              {!lockedComponents && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 3 }}>
                  <FormControlLabel
                    control={(
                      <Checkbox
                        checked={includePlan}
                        onChange={(_, checked) => setIncludePlan(checked)}
                      />
                    )}
                    label="Plan price (including separate hardware)"
                  />
                  <FormControlLabel
                    control={(
                      <Checkbox
                        checked={includeOptions}
                        onChange={(_, checked) => setIncludeOptions(checked)}
                      />
                    )}
                    label="Options"
                  />
                </Stack>
              )}

              <Box>
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={allSelected}
                      indeterminate={activeSelected.length > 0 && !allSelected}
                      disabled={selectablePhaseIds.length === 0}
                      onChange={(_, checked) => setSelected(checked ? selectablePhaseIds : [])}
                    />
                  )}
                  label={`Select all (${selectablePhaseIds.length})`}
                />

                <Stack
                  divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}
                  sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}
                >
                  {phases.map((phase) => {
                    const eligible = eligibleByPhase.get(phase.phaseId)
                    const disabled = eligible.count === 0
                    const lines = disabled ? [] : phaseLines(phase, components)
                    const drafts = eligible.packages.filter((item) => item.recalculable)
                    const issued = eligible.packages.filter((item) => !item.recalculable)

                    return (
                      <Stack
                        key={phase.phaseId}
                        direction="row"
                        spacing={1}
                        sx={{ px: 1, py: 1, alignItems: 'flex-start' }}
                      >
                        <Checkbox
                          checked={activeSelected.includes(phase.phaseId)}
                          disabled={disabled}
                          onChange={() => togglePhase(phase.phaseId)}
                          sx={{ mt: -0.5 }}
                          slotProps={{ input: { 'aria-label': `Select Phase ${phase.label}` } }}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            Phase {phase.label}
                          </Typography>
                          {disabled ? (
                            <Typography variant="caption" color="text.secondary">
                              Nothing to update for the chosen components
                            </Typography>
                          ) : (
                            <>
                              <PhaseChangeLines
                                lines={lines}
                                expanded={expanded.includes(phase.phaseId)}
                                onToggle={() => toggleExpanded(phase.phaseId)}
                              />
                              {(drafts.length > 0 || issued.length > 0) && (
                                <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
                                  {[
                                    drafts.length > 0
                                      ? `Recalculates Draft ${drafts.length === 1 ? 'Package' : 'Packages'} ${packageNumbers(drafts)}`
                                      : null,
                                    issued.length > 0
                                      ? `${packageNumbers(issued)} ${issued.length === 1 ? 'keeps' : 'keep'} the amount billed`
                                      : null,
                                  ].filter(Boolean).join(' · ')}
                                </Typography>
                              )}
                            </>
                          )}
                        </Box>
                      </Stack>
                    )
                  })}
                </Stack>
              </Box>

              {draftPackages.length > 0 && (
                <Alert severity="info">
                  These Draft Packages will be calculated again with the new prices:{' '}
                  <strong>{packageNumbers(draftPackages)}</strong>. Their number, Lots and Draws stay the same.
                </Alert>
              )}

              {issuedPackages.length > 0 && (
                <Alert severity="warning">
                  These Packages already have a QuickBooks invoice, were sent or are paid, so they keep
                  the amount they billed. The difference with the new price is recorded as pending to
                  collect (nothing is invoiced now):{' '}
                  <strong>
                    {issuedPackages
                      .map((item) => `${item.packageNumber} (${workflowStatusLabel(item.workflowStatus)})`)
                      .join(', ')}
                  </strong>.
                </Alert>
              )}

              {documentsNeedRemoval && (
                <Alert severity="warning">
                  <Stack spacing={0.5}>
                    <Typography variant="body2">
                      {plural(summary.packagesWithDocuments, 'of these Package')} has a generated Release or
                      Payment Schedule. It no longer matches the new amounts, so it is removed and has to be
                      generated again from the Package.
                    </Typography>
                    <FormControlLabel
                      control={(
                        <Checkbox
                          checked={removeDocuments}
                          onChange={(_, checked) => setRemoveDocuments(checked)}
                        />
                      )}
                      label="Remove them and recalculate"
                    />
                  </Stack>
                </Alert>
              )}

              <TextField
                label="Reason for the change"
                placeholder="For example: new price list for 2027"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                multiline
                minRows={2}
                fullWidth
                disabled={submitting}
                error={reason.length > 0 && !reasonValid}
                helperText={
                  reason.length > 0 && !reasonValid
                    ? 'Enter between 3 and 500 characters.'
                    : 'Saved with your name and the date.'
                }
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
            </>
          )}

          {submitError && <Alert severity="error">{submitError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
        {status === 'ready' && summary.lotCount + summary.optionCount > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto' }}>
            {plural(summary.phaseCount, 'Phase')} · {plural(summary.lotCount, 'Plan price')} ·{' '}
            {plural(summary.optionCount, 'Option price')}
            {summary.packageCount > 0 ? ` · ${plural(summary.packageCount, 'Draft Package')}` : ''}
            {summary.issuedPackageCount > 0 ? ` · ${plural(summary.issuedPackageCount, 'issued Package')}` : ''}
          </Typography>
        )}
        <Button onClick={onClose} disabled={submitting} color="inherit" sx={{ textTransform: 'none' }}>
          {phases.length > 0 ? 'Keep old prices' : 'Close'}
        </Button>
        {phases.length > 0 && (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={!canSubmit}
            disableElevation
            sx={{ textTransform: 'none' }}
          >
            {submitting
              ? 'Updating…'
              : summary.phaseCount > 0
                ? `Update ${plural(summary.phaseCount, 'Phase')}`
                : 'Update Phases'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
