import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import {
  applyPhasePriceChanges,
  previewPhasePriceChanges,
} from '../services/phasePriceRepository.js'
import {
  groupPlanChanges,
  phaseEligibleChanges,
  summarizePhasePriceRequest,
  buildPhasePriceRequest,
  toPhasePriceChanges,
} from '../utils/phasePriceChanges.js'

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

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function PhaseChangeDetails({ phase, components }) {
  const planGroups = components.includePlan ? groupPlanChanges(phase) : []
  const optionLines = components.includeOptions
    ? phase.lots.flatMap((lot) => lot.options.map((option) => ({ lot, option })))
    : []

  return (
    <Stack spacing={0.75} sx={{ py: 1, pl: 6 }}>
      {planGroups.map((group) => (
        <Typography key={`${group.planCode}-${group.fromBase}-${group.toBase}-${group.billed}`} variant="body2">
          Plan {group.planCode}:{' '}
          <strong>{formatMoney(group.fromBase)} → {formatMoney(group.toBase)}</strong>
          {group.hardwareChanged && (
            <> · Hardware {formatMoney(group.fromHardware)} → {formatMoney(group.toHardware)}</>
          )}
          {' '}· {plural(group.lotCount, 'lot')}
          {group.billed && (
            <Chip size="small" color="warning" variant="outlined" label="In a Package" sx={{ ml: 1 }} />
          )}
        </Typography>
      ))}
      {optionLines.map(({ lot, option }) => (
        <Typography key={`${lot.lotId}-${option.optionId}`} variant="body2" color="text.secondary">
          {lot.label} · {option.code}
          {option.description ? ` · ${option.description}` : ''}:{' '}
          {formatOption(option.fromPrice, option.fromNotApplicable)} →{' '}
          {formatOption(option.toPrice, option.toNotApplicable)}
          {option.billed && (
            <Chip size="small" color="warning" variant="outlined" label="In a Package" sx={{ ml: 1 }} />
          )}
        </Typography>
      ))}
    </Stack>
  )
}

/**
 * Moves Phases created before a price change to today's price. The list comes from
 * the server; Phases already billed in a Package are shown but cannot be picked,
 * and a reason is required. Packages are never touched here.
 *
 * `filter` narrows the list to what was just changed ({ planId, optionId,
 * components }); without it every Phase of the Job with an older price is listed.
 */
export default function UpdatePhasePricesDialog({ job, filter = {}, onClose, onApplied }) {
  const lockedComponents = filter.components && filter.components !== 'ALL'
    ? filter.components
    : null
  const [status, setStatus] = useState('loading')
  const [loadError, setLoadError] = useState(null)
  const [phases, setPhases] = useState([])
  const [selected, setSelected] = useState([])
  const [expanded, setExpanded] = useState([])
  const [includePlan, setIncludePlan] = useState(lockedComponents !== 'OPTIONS')
  const [includeOptions, setIncludeOptions] = useState(lockedComponents !== 'PLAN')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const components = useMemo(
    () => ({ includePlan, includeOptions }),
    [includePlan, includeOptions],
  )

  useEffect(() => {
    let cancelled = false

    previewPhasePriceChanges(job.id, {
      planId: filter.planId,
      optionId: filter.optionId,
      components: filter.components ?? 'ALL',
    })
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
  }, [job.id, filter.planId, filter.optionId, filter.components, reloadKey])

  const eligibleByPhase = useMemo(
    () => new Map(phases.map((phase) => [phase.phaseId, phaseEligibleChanges(phase, components)])),
    [phases, components],
  )
  const selectablePhaseIds = phases
    .filter((phase) => eligibleByPhase.get(phase.phaseId).count > 0)
    .map((phase) => phase.phaseId)
  const activeSelected = selected.filter((id) => selectablePhaseIds.includes(id))
  const summary = summarizePhasePriceRequest(phases, activeSelected, components)
  const blockedCount = phases.reduce(
    (total, phase) => total + eligibleByPhase.get(phase.phaseId).blocked,
    0,
  )
  const reasonValid = reason.trim().length >= 3 && reason.trim().length <= 500
  const canSubmit = !submitting
    && status === 'ready'
    && summary.lotCount + summary.optionCount > 0
    && reasonValid

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
      const result = await applyPhasePriceChanges(job.id, { ...request, reason })
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
      <DialogTitle sx={{ fontWeight: 700 }}>Update prices of existing Phases</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {filter.fromSave
              ? 'The price was saved. Phases created before it keep the price they were created with. Choose the ones that should take today\'s price.'
              : 'Each Phase keeps the price it was created with. Choose the Phases that should take today\'s price.'}
            {' '}Packages that already exist are never changed here.
          </Typography>

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

              {blockedCount > 0 && (
                <Alert severity="warning">
                  {plural(blockedCount, 'price')} already {blockedCount === 1 ? 'belongs' : 'belong'} to a
                  Package and cannot be changed here.
                </Alert>
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

                <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                  {phases.map((phase) => {
                    const eligible = eligibleByPhase.get(phase.phaseId)
                    const disabled = eligible.count === 0
                    const open = expanded.includes(phase.phaseId)

                    return (
                      <Box key={phase.phaseId}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 1, py: 0.5 }}>
                          <Checkbox
                            checked={activeSelected.includes(phase.phaseId)}
                            disabled={disabled}
                            onChange={() => togglePhase(phase.phaseId)}
                            slotProps={{ input: { 'aria-label': `Select Phase ${phase.label}` } }}
                          />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={700}>Phase {phase.label}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {disabled
                                ? 'Everything that changed is already in a Package'
                                : `${plural(eligible.lots.length, 'Plan price')} · ${plural(eligible.options.length, 'Option price')} to update`}
                            </Typography>
                          </Box>
                          <IconButton
                            size="small"
                            aria-label={open ? 'Hide details' : 'Show details'}
                            aria-expanded={open}
                            onClick={() => toggleExpanded(phase.phaseId)}
                          >
                            <ExpandMoreRoundedIcon
                              sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}
                            />
                          </IconButton>
                        </Stack>
                        <Collapse in={open} unmountOnExit>
                          <PhaseChangeDetails phase={phase} components={components} />
                        </Collapse>
                      </Box>
                    )
                  })}
                </Stack>
              </Box>

              <TextField
                label="Reason for the change"
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
                    : 'It is saved with who changed it and when.'
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
          </Typography>
        )}
        <Button onClick={onClose} disabled={submitting} color="inherit">
          {phases.length > 0 ? 'Keep previous prices' : 'Close'}
        </Button>
        {phases.length > 0 && (
          <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? 'Updating…' : 'Update selected Phases'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
