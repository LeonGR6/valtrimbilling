import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { useDrawInvoicePackages } from '../../draw-invoice/context/useDrawInvoicePackages.js'
import { getJobBuilderId, jobDrawInvoicePath } from '../../jobs/utils/jobRoutes.js'
import { listPendingPriceDifferences } from '../services/priceDifferencesRepository.js'
import {
  adjustmentIssue,
  differenceComponents,
  formatSignedMoney,
  groupPriceDifferences,
  selectedDifferenceTotals,
  workflowStatusLabel,
} from '../utils/priceDifferences.js'

const numeric = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

function Totals({ totals, netLabel = 'Net to collect' }) {
  const items = [
    ['Gross', totals.gross],
    ['Retention', totals.retention],
    ['WRAP', totals.wrap],
    [netLabel, totals.net],
  ]

  return (
    <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 1 }} useFlexGap>
      {items.map(([label, amount]) => (
        <Box key={label}>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
          <Typography
            variant={label === netLabel ? 'h6' : 'body1'}
            fontWeight={700}
            sx={numeric}
          >
            {formatSignedMoney(amount)}
          </Typography>
        </Box>
      ))}
    </Stack>
  )
}

function PackageRows({ item, checked, disabled, onToggle }) {
  const [open, setOpen] = useState(false)

  return (
    <Fragment>
      <TableRow hover>
        <TableCell sx={{ width: 48, px: 1 }}>
          <Checkbox
            checked={checked}
            disabled={disabled}
            onChange={() => onToggle(item.packageId)}
            slotProps={{ input: { 'aria-label': `Select ${item.packageNumber}` } }}
          />
        </TableCell>
        <TableCell sx={{ width: 40, px: 0 }}>
          <IconButton
            size="small"
            aria-label={open ? 'Hide lines' : 'Show lines'}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <ExpandMoreRoundedIcon
              sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}
            />
          </IconButton>
        </TableCell>
        <TableCell>
          <Typography variant="body2" fontWeight={700}>{item.packageNumber}</Typography>
          <Typography variant="caption" color="text.secondary">
            {item.totals.lineCount === 1 ? '1 line' : `${item.totals.lineCount} lines`}
          </Typography>
        </TableCell>
        <TableCell>
          <Chip size="small" variant="outlined" label={workflowStatusLabel(item.status)} />
        </TableCell>
        <TableCell align="right" sx={numeric}>{formatSignedMoney(item.totals.gross)}</TableCell>
        <TableCell align="right" sx={numeric}>{formatSignedMoney(item.totals.retention)}</TableCell>
        <TableCell align="right" sx={numeric}>{formatSignedMoney(item.totals.wrap)}</TableCell>
        <TableCell align="right" sx={{ ...numeric, fontWeight: 700 }}>
          {formatSignedMoney(item.totals.net)}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={8} sx={{ p: 0, borderBottom: open ? undefined : 0 }}>
          <Collapse in={open} unmountOnExit>
            <Stack spacing={0.5} sx={{ px: 8, py: 1.5, bgcolor: 'action.hover' }}>
              {item.lines.map((line) => (
                <Typography key={line.id} variant="body2" sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1 }}>
                  <strong>Phase {line.phaseLabel}</strong>
                  <span>· {line.label}</span>
                  <span style={numeric}>
                    · {differenceComponents(line)
                      .map(([name, amount]) => `${name} ${formatSignedMoney(amount)}`)
                      .join(', ')}
                  </span>
                  <span style={numeric}>
                    · net {formatSignedMoney(line.net)}
                  </span>
                </Typography>
              ))}
            </Stack>
          </Collapse>
        </TableCell>
      </TableRow>
    </Fragment>
  )
}

/**
 * What Packages that cannot change (QuickBooks invoice, sent or paid) would have
 * billed at the new prices of their Phases, minus what they billed: pending to
 * collect, with Retention and WRAP. The chosen Packages can be invoiced in a Price
 * Adjustment Package. Credits and charges add up, and only a positive total can be
 * invoiced.
 */
export default function PriceDifferencesDialog({ job, onClose }) {
  const navigate = useNavigate()
  const { createPriceAdjustmentPackage } = useDrawInvoicePackages()
  const [state, setState] = useState({ status: 'loading', groups: null, error: null })
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState([])
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  useEffect(() => {
    let cancelled = false

    listPendingPriceDifferences({ jobId: job.id })
      .then(({ rows, statuses }) => {
        if (cancelled) return
        setState({ status: 'ready', groups: groupPriceDifferences(rows, statuses), error: null })
        setSelected([])
      })
      .catch((error) => {
        if (cancelled) return
        setState({ status: 'error', groups: null, error: error.message })
      })

    return () => { cancelled = true }
  }, [job.id, reloadKey])

  const groups = state.groups
  const selectedTotals = useMemo(
    () => (groups ? selectedDifferenceTotals(groups.packages, selected) : null),
    [groups, selected],
  )
  const issue = selectedTotals ? adjustmentIssue(selectedTotals) : null
  const canCreate = !creating && selected.length > 0 && !issue
  const allSelected = Boolean(groups)
    && groups.packages.length > 0
    && groups.packages.every((item) => selected.includes(item.packageId))

  const toggle = (packageId) => {
    setSelected((current) => (
      current.includes(packageId)
        ? current.filter((id) => id !== packageId)
        : [...current, packageId]
    ))
  }

  const handleCreate = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const record = await createPriceAdjustmentPackage({
        jobId: job.id,
        sourcePackageIds: selected,
        notes,
      })
      const phaseId = record.phaseId ?? job.sequenceSheet?.phases?.[0]?.id ?? null
      onClose()
      navigate(jobDrawInvoicePath(getJobBuilderId(job), job.id, phaseId, record.id))
    } catch (error) {
      setCreateError(error.message)
      setCreating(false)
    }
  }

  return (
    <Dialog open onClose={creating ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 700 }}>Pending price differences</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Packages that already have a QuickBooks invoice, were sent or are paid keep the amount they
            billed. This is what the same Draws would have billed at the new price of their Phases,
            minus what was billed. It includes Retention and WRAP. A negative amount is a credit.
            Choose the Packages to invoice in a Price Adjustment Package: credits and charges add up.
          </Typography>

          {state.status === 'loading' && (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">Loading differences…</Typography>
            </Stack>
          )}

          {state.status === 'error' && (
            <Alert
              severity="error"
              action={(
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => {
                    setState({ status: 'loading', groups: null, error: null })
                    setReloadKey((key) => key + 1)
                  }}
                >
                  Retry
                </Button>
              )}
            >
              {state.error}
            </Alert>
          )}

          {state.status === 'ready' && groups.packages.length === 0 && (
            <Alert severity="success">
              Nothing is pending. No issued Package has a difference with the current prices.
            </Alert>
          )}

          {state.status === 'ready' && groups.packages.length > 0 && (
            <>
              <Totals totals={groups.totals} />
              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 48, px: 1 }}>
                        <Checkbox
                          checked={allSelected}
                          indeterminate={selected.length > 0 && !allSelected}
                          onChange={(_, checked) => setSelected(
                            checked ? groups.packages.map((item) => item.packageId) : [],
                          )}
                          slotProps={{ input: { 'aria-label': 'Select all Packages' } }}
                        />
                      </TableCell>
                      <TableCell sx={{ width: 40, px: 0 }} />
                      <TableCell>Package</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Gross</TableCell>
                      <TableCell align="right">Retention</TableCell>
                      <TableCell align="right">WRAP</TableCell>
                      <TableCell align="right">Net</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {groups.packages.map((item) => (
                      <PackageRows
                        key={item.packageId}
                        item={item}
                        checked={selected.includes(item.packageId)}
                        disabled={creating}
                        onToggle={toggle}
                      />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              {selected.length > 0 && (
                <Stack spacing={1.5}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    Price Adjustment Package · {selected.length} {selected.length === 1 ? 'Package' : 'Packages'}
                  </Typography>
                  <Totals totals={selectedTotals} netLabel="Invoice amount" />
                  {issue ? (
                    <Alert severity="warning">{issue}</Alert>
                  ) : (
                    <Alert severity="info">
                      Retention and WRAP are deducted like in any Package. The Retention Release will
                      include what is retained here. The Package is created as a Draft and is not sent to
                      QuickBooks from here.
                    </Alert>
                  )}
                  <TextField
                    label="Notes (optional)"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    multiline
                    minRows={2}
                    fullWidth
                    disabled={creating}
                    slotProps={{ htmlInput: { maxLength: 500 } }}
                  />
                </Stack>
              )}
            </>
          )}

          {createError && <Alert severity="error">{createError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={creating} color="inherit">Close</Button>
        {state.status === 'ready' && groups.packages.length > 0 && (
          <Button variant="contained" onClick={handleCreate} disabled={!canCreate}>
            {creating ? 'Creating…' : 'Create Price Adjustment'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
