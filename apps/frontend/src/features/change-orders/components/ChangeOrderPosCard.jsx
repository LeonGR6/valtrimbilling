import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'

import { MATCH_LEVELS } from '../services/changeOrderLinePoRecord.js'

const lotsText = (lots) => (lots.length === 1 ? `Lot ${lots[0]}` : `Lots ${lots.join(', ')}`)

/**
 * The builder POs behind the Extra / CO: how many of its Lots have one, each PO with the Lots it backs
 * and its PDF, and the Lots still without a PO. It only informs; the POs come from the Documents tab.
 */
export default function ChangeOrderPosCard({ summary, loading, error, openingId, onOpen }) {
  const { total, backed, missing, pos } = summary
  const complete = total > 0 && backed === total

  return (
    <Paper variant="outlined" component="section" aria-label="Purchase Orders" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Stack direction="row" spacing={1.5} sx={{ px: { xs: 2, md: 3 }, py: 2, alignItems: 'center' }}>
        <ReceiptLongRoundedIcon color={complete ? 'success' : 'action'} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2" fontWeight={700}>Purchase Orders</Typography>
          <Typography variant="body2" color="text.secondary">
            {loading
              ? 'Looking for the POs of each Lot…'
              : total === 0
                ? 'No lines.'
                : `${backed} of ${total} ${total === 1 ? 'line has' : 'lines have'} the builder's PO.`}
          </Typography>
        </Box>
      </Stack>

      {error && <Alert severity="warning" sx={{ mx: { xs: 2, md: 3 }, mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ px: { xs: 2, md: 3 }, pb: 2 }}><Skeleton variant="rounded" height={48} /></Box>
      ) : (
        <Stack sx={{ borderTop: pos.length > 0 || missing.length > 0 ? 1 : 0, borderColor: 'divider' }}>
          {pos.map((po) => {
            const level = MATCH_LEVELS[po.level]
            const lots = po.lots.length > 0 ? lotsText(po.lots) : ''
            const places = po.places > 0 ? `${po.places} line${po.places === 1 ? '' : 's'} with no Lot` : ''
            return (
              <Stack
                key={po.poId}
                direction="row"
                spacing={1.5}
                sx={{ px: { xs: 2, md: 3 }, py: 1.5, alignItems: 'center', '& + &': { borderTop: 1, borderColor: 'divider' } }}
              >
                {po.level === 'LOT'
                  ? <WarningAmberRoundedIcon color="warning" fontSize="small" titleAccess={level.label} />
                  : <CheckCircleRoundedIcon color="success" fontSize="small" titleAccess={level.label} />}
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                    {po.kindLabel} {po.number || '(no number printed)'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {[lots, places].filter(Boolean).join(' · ')}
                    {po.level === 'LOT' && ' · only the Lot matches: check the amount'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div" title={po.file.name}>
                    {po.file.name}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={openingId === po.file.id}
                  startIcon={openingId === po.file.id ? <CircularProgress size={14} /> : <OpenInNewRoundedIcon />}
                  onClick={() => onOpen(po.file)}
                  aria-label={`Open ${po.file.name}`}
                  sx={{ flexShrink: 0, textTransform: 'none' }}
                >
                  Open PDF
                </Button>
              </Stack>
            )
          })}
          {missing.length > 0 && (
            <Box sx={{ px: { xs: 2, md: 3 }, py: 1.5, borderTop: pos.length > 0 ? 1 : 0, borderColor: 'divider', bgcolor: 'action.hover' }}>
              <Typography variant="body2" fontWeight={600}>
                Without a PO: {missing.map((line) => (line.lot ? `Lot ${line.lot}` : line.location || 'line with no Lot')).join(', ')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Upload the builder&apos;s PO in Extras / COs → Documents and read it; it is matched here by Lot.
              </Typography>
            </Box>
          )}
        </Stack>
      )}
    </Paper>
  )
}
