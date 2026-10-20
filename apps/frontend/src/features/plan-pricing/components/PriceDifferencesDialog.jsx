import { Fragment, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
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
  Typography,
} from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { listPendingPriceDifferences } from '../services/priceDifferencesRepository.js'
import {
  differenceComponents,
  formatSignedMoney,
  groupPriceDifferences,
  workflowStatusLabel,
} from '../utils/priceDifferences.js'

const numeric = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

function Totals({ totals }) {
  const items = [
    ['Gross', totals.gross],
    ['Retention', totals.retention],
    ['WRAP', totals.wrap],
    ['Net to collect', totals.net],
  ]

  return (
    <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 1 }} useFlexGap>
      {items.map(([label, amount]) => (
        <Box key={label}>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
          <Typography
            variant={label === 'Net to collect' ? 'h6' : 'body1'}
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

function PackageRows({ item }) {
  const [open, setOpen] = useState(false)

  return (
    <Fragment>
      <TableRow hover>
        <TableCell sx={{ width: 40, px: 1 }}>
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
        <TableCell colSpan={7} sx={{ p: 0, borderBottom: open ? undefined : 0 }}>
          <Collapse in={open} unmountOnExit>
            <Stack spacing={0.5} sx={{ px: 6, py: 1.5, bgcolor: 'action.hover' }}>
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
 * collect, with Retention and WRAP. It is only shown; nothing is invoiced from here.
 */
export default function PriceDifferencesDialog({ job, onClose }) {
  const [state, setState] = useState({ status: 'loading', groups: null, error: null })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    listPendingPriceDifferences({ jobId: job.id })
      .then(({ rows, statuses }) => {
        if (cancelled) return
        setState({ status: 'ready', groups: groupPriceDifferences(rows, statuses), error: null })
      })
      .catch((error) => {
        if (cancelled) return
        setState({ status: 'error', groups: null, error: error.message })
      })

    return () => { cancelled = true }
  }, [job.id, reloadKey])

  const groups = state.groups

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 700 }}>Pending price differences</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Packages that already have a QuickBooks invoice, were sent or are paid keep the amount they
            billed. This is what the same Draws would have billed at the new price of their Phases,
            minus what was billed. It includes Retention and WRAP. A negative amount is a credit.
            Nothing is invoiced from here.
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
                      <TableCell sx={{ width: 40, px: 1 }} />
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
                      <PackageRows key={item.packageId} item={item} />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
