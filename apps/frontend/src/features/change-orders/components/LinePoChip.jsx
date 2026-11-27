import { useId, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'

import { formatCurrency, formatDate } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { MATCH_LEVELS, describeMatch } from '../services/changeOrderLinePoRecord.js'

function Fact({ label, children }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div">{label}</Typography>
      <Typography variant="body2" fontWeight={650} sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  )
}

/** One PO behind the line, laid out like the top of the order it came from, with its PDF. */
export function PoMatchSlip({ match, opening, onOpen }) {
  const { amount, net, facts } = describeMatch(match, formatCurrency)
  const level = MATCH_LEVELS[match.level]
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" component="div">{match.kindLabel}</Typography>
          <Typography component="div" fontWeight={800} sx={{ fontSize: 18, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
            {match.number || 'No number printed'}
          </Typography>
        </Box>
        <Chip size="small" color={level.color} label={match.level === 'LOT' ? 'Check' : 'Matches'} />
      </Stack>

      <Box sx={{ mt: 1.25, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 1.25 }}>
        {match.lotText && <Fact label="Lot on the PO">{match.lotText}</Fact>}
        {amount && <Fact label="Amount on the PO">{amount}</Fact>}
        {net && <Fact label="Net of OCIP">{net}</Fact>}
        {match.issuedDate && <Fact label="Dated">{formatDate(match.issuedDate)}</Fact>}
      </Box>

      {match.description && (
        <Typography variant="body2" sx={{ mt: 1.25, overflowWrap: 'anywhere' }}>{match.description}</Typography>
      )}
      <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 1 }}>
        {facts.map((fact) => <div key={fact}>{fact}</div>)}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mt: 1.25, alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" noWrap title={match.file.name} sx={{ flex: 1, minWidth: 0 }}>
          {match.file.name}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          disabled={opening}
          startIcon={opening ? <CircularProgress size={14} /> : <OpenInNewRoundedIcon />}
          onClick={() => onOpen(match.file)}
          aria-label={`Open ${match.file.name}`}
          sx={{ flexShrink: 0, textTransform: 'none' }}
        >
          Open PDF
        </Button>
      </Stack>
    </Box>
  )
}

/**
 * The PO of a line of an Extra / CO. Without one it says so; with one it is a chip with a receipt mark
 * (green when the PO agrees, amber when only the Lot does) that opens the PO with a button for its PDF.
 */
export default function LinePoChip({ matches = [], fallback = '', openingId, onOpen }) {
  const [anchor, setAnchor] = useState(null)
  const cardId = useId()

  if (matches.length === 0) {
    return fallback
      ? <Typography variant="body2" component="span">{fallback}</Typography>
      : <Typography variant="body2" component="span" color="text.disabled">No PO</Typography>
  }

  const agrees = matches.every((match) => match.level !== 'LOT')
  const label = matches.map((match) => match.number || 'PO').join(', ')
  const open = Boolean(anchor)

  return (
    <>
      <Tooltip title={open ? '' : `${agrees ? 'Matches' : 'Needs a look'}. Click to see the PO and open its PDF.`}>
        <Chip
          size="small"
          variant="outlined"
          label={label}
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? cardId : undefined}
          icon={<ReceiptLongRoundedIcon />}
          sx={(theme) => ({
            maxWidth: 220,
            '& .MuiChip-icon': { color: agrees ? theme.palette.success.main : theme.palette.warning.main },
          })}
        />
      </Tooltip>
      <Popover
        id={cardId}
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 2, width: 340, maxWidth: 'calc(100vw - 32px)' }, role: 'dialog', 'aria-label': 'Purchase Order of the line' } }}
      >
        <Stack spacing={2} divider={<Divider flexItem />}>
          {matches.map((match) => (
            <PoMatchSlip
              key={`${match.poId}-${match.poLineNumber}`}
              match={match}
              opening={openingId === match.file.id}
              onOpen={onOpen}
            />
          ))}
        </Stack>
      </Popover>
    </>
  )
}
