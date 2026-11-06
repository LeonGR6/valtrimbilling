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
import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { describeOptionOrder } from '../services/purchaseOrderRecord.js'

function formatDate(value) {
  if (!value) return null
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Fact({ label, children }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div">{label}</Typography>
      <Typography variant="body2" fontWeight={650} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {children}
      </Typography>
    </Box>
  )
}

/** One Purchase Order line, laid out like the top of the slip it came from. */
function OrderSlip({ line, file, opening, onOpen }) {
  const info = describeOptionOrder(line, formatCurrency)
  const revised = formatDate(line.revisedOn)
  const dated = formatDate(line.poDate)

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" component="div">Work order</Typography>
          <Typography
            component="div"
            fontWeight={800}
            sx={{ fontSize: 18, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}
          >
            {info.workOrderNo ?? 'Not printed'}
          </Typography>
        </Box>
        <Chip size="small" color={info.status.color} label={info.status.label} />
      </Stack>

      <Box
        sx={{
          mt: 1.25,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
          gap: 1.25,
        }}
      >
        {info.referenceNo && <Fact label="Reference">{info.referenceNo}</Fact>}
        {dated && <Fact label="Dated">{dated}</Fact>}
        {revised && <Fact label="Revised">{revised}</Fact>}
        {info.quantity > 1 && <Fact label="Quantity">{info.quantity}</Fact>}
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>
        {info.hint}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mt: 1.25, alignItems: 'center' }}>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          title={file?.name}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {file ? file.name : 'The PDF is no longer available'}
        </Typography>
        {file && (
          <Button
            size="small"
            variant="outlined"
            disabled={opening}
            startIcon={opening ? <CircularProgress size={14} /> : <OpenInNewRoundedIcon />}
            onClick={() => onOpen(file)}
            aria-label={`Open ${file.name}`}
            sx={{ flexShrink: 0, textTransform: 'none' }}
          >
            Open PDF
          </Button>
        )}
      </Stack>
    </Box>
  )
}

/**
 * An option of a Lot in the Sequence Sheet. Without a Purchase Order it is the plain chip
 * it always was. With one it carries a receipt mark (green when the order agrees, amber
 * when it needs a look): hovering says so in a line, and clicking, or Enter, opens the order
 * with a button for its PDF. It only informs.
 */
export default function OptionOrderChip({
  option,
  lot,
  lines,
  files,
  openingId,
  onOpenFile,
}) {
  const [anchor, setAnchor] = useState(null)
  const cardId = useId()
  const label = `${option.code} · ${option.description}`

  if (lines.length === 0) {
    return <Chip size="small" variant="outlined" label={label} />
  }

  const agrees = lines.every((line) => line.status === 'MATCH')
  const numbers = lines.map((line) => line.workOrderNo).filter(Boolean)
  const summary = numbers.length > 0 ? `Purchase Order ${numbers.join(', ')}` : 'Has a Purchase Order'
  const open = Boolean(anchor)

  return (
    <>
      <Tooltip title={open ? '' : `${summary}. ${agrees ? 'Matches.' : 'Needs a look.'} Click for details.`}>
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
            '& .MuiChip-icon': { color: agrees ? theme.palette.success.main : theme.palette.warning.main },
            '&:hover': { borderColor: theme.palette.text.secondary },
          })}
        />
      </Tooltip>

      <Popover
        id={cardId}
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 'min(380px, calc(100vw - 32px))', mt: 0.75, borderRadius: 2 } } }}
        aria-label={`Purchase Order for option ${option.code}`}
      >
        <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            Lot {lot.lotNumber} · {lines.length === 1 ? 'Purchase Order' : `${lines.length} Purchase Orders`}
          </Typography>
          <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
            {label}
          </Typography>
        </Box>
        <Divider />
        <Stack
          divider={<Divider flexItem sx={{ borderStyle: 'dashed' }} />}
          spacing={1.5}
          sx={{ p: 2 }}
        >
          {lines.map((line) => (
            <OrderSlip
              key={line.lineId}
              line={line}
              file={files[line.documentId]}
              opening={openingId === line.documentId}
              onOpen={onOpenFile}
            />
          ))}
        </Stack>
      </Popover>
    </>
  )
}
