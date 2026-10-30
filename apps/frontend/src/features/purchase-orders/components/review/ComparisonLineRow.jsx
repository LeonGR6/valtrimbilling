import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded'
import PriceCheckRoundedIcon from '@mui/icons-material/PriceCheckRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { formatCurrency, formatOptionPrice } from '../../../draw-invoice/utils/drawInvoiceFormatters.js'
import {
  COMPARISON_STATUSES,
  canUsePdfPrice,
  importAction,
  lineStatusLabel,
  priceDifference,
} from '../../services/purchaseOrderRecord.js'

// The row's columns: option, what the PDF says, what the system says, the result.
const ROW_COLUMNS = { xs: '1fr', md: '104px minmax(0, 1fr) minmax(0, 1fr) 232px' }

function signedCurrency(value) {
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`
}

/** The labels over the columns, shown above a work order's lines on wide screens. */
export function ComparisonColumnHeads() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        display: { xs: 'none', md: 'grid' },
        gridTemplateColumns: ROW_COLUMNS,
        columnGap: 2,
        pl: '20px',
        pr: 1.5,
        py: 0.75,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      {['Option', 'In the PDF', 'In the system', 'Result'].map((label) => (
        <Typography key={label} variant="caption" color="text.secondary" fontWeight={700}>
          {label}
        </Typography>
      ))}
    </Box>
  )
}

function SideLabel({ children }) {
  // Only where the columns are stacked and the heads above are not shown.
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      fontWeight={700}
      sx={{ display: { xs: 'block', md: 'none' } }}
    >
      {children}
    </Typography>
  )
}

/**
 * One option of a work order: what the PDF prints next to what the system holds, and the
 * result with the action that fixes it. The bar on the left carries the result's color.
 */
export default function ComparisonLineRow({ line, onImportLine, onUsePrice }) {
  const info = COMPARISON_STATUSES[line.status]
  if (!info) return null

  const [first, ...rest] = line.descriptionLines
  const difference = line.status === 'PRICE_DIFF' ? priceDifference(line) : null
  const inSystem = Boolean(line.optionName)

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ROW_COLUMNS,
        columnGap: 2,
        rowGap: 1,
        alignItems: 'start',
        pl: '16px',
        pr: 1.5,
        py: 1.25,
        borderLeft: 4,
        borderLeftColor: `${info.color}.main`,
        // What already matches is quieter, so the lines that need a look stand out.
        color: info.color === 'success' ? 'text.secondary' : 'text.primary',
        '&:not(:last-child)': { borderBottom: 1, borderBottomColor: 'divider' },
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box>
        <Typography variant="body2" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {line.optionCode}
        </Typography>
        <Typography variant="caption" color="text.secondary">Ref {line.referenceNo}</Typography>
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <SideLabel>In the PDF</SideLabel>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{first ?? '—'}</Typography>
        {rest.length > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            title={rest.join(' · ')}
            sx={{ display: 'block', overflowWrap: 'anywhere' }}
          >
            {rest.join(' · ')}
          </Typography>
        )}
        <Typography variant="body2" fontWeight={800} sx={{ mt: 0.25, fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(line.poUnitPrice)}
          {line.quantity !== 1 && (
            <Typography component="span" variant="caption" color="text.secondary" fontWeight={500}>
              {' '}× {line.quantity}
            </Typography>
          )}
        </Typography>
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <SideLabel>In the system</SideLabel>
        {inSystem ? (
          <>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{line.optionName}</Typography>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.25 }}>
              <Typography variant="body2" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatOptionPrice(line.systemPrice, line.systemNotApplicable)}
              </Typography>
              {line.conflictingPoPrices && (
                <Tooltip title="Purchase Orders of other Lots of this Plan print a different price for this option. An option has one price per Plan.">
                  <WarningAmberRoundedIcon color="warning" sx={{ fontSize: 17 }} />
                </Tooltip>
              )}
            </Stack>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Not in this Plan
          </Typography>
        )}
      </Box>

      <Stack spacing={0.75} sx={{ alignItems: 'flex-start' }}>
        <Tooltip title={info.hint}>
          <Chip
            size="small"
            color={info.color}
            variant={info.color === 'success' ? 'outlined' : 'filled'}
            label={difference === null ? lineStatusLabel(line) : `${info.label} · ${signedCurrency(difference)} in the PDF`}
          />
        </Tooltip>
        {onUsePrice && canUsePdfPrice(line) && (
          <Tooltip title="Suggestion only: nothing changes until you confirm.">
            <Button
              size="small"
              startIcon={<PriceCheckRoundedIcon />}
              aria-label={`Use the PDF price for ${line.optionCode} in Lot ${line.lotNumber}`}
              onClick={() => onUsePrice(line)}
              sx={{ textTransform: 'none' }}
            >
              Use PDF price
            </Button>
          </Tooltip>
        )}
        {onImportLine && importAction(line) && (
          <Button
            size="small"
            startIcon={<PlaylistAddRoundedIcon />}
            aria-label={`Add ${line.optionCode} to Lot ${line.lotNumber}`}
            onClick={() => onImportLine(line)}
            sx={{ textTransform: 'none' }}
          >
            {importAction(line) === 'create'
              ? 'Create and add'
              : `Add to the sequence sheet (Lot ${line.lotNumber})`}
          </Button>
        )}
      </Stack>
    </Box>
  )
}
