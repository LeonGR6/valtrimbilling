import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert, Box, Button, Skeleton, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'

export const QUEUE_PREVIEW_LIMIT = 8

const RAIL_COLORS = { late: 'urgency.late', soon: 'urgency.soon', wait: 'text.disabled' }
const TEXT_COLORS = { late: 'urgency.late', soon: 'urgency.soon', wait: 'text.primary' }

function QueueRow({ item }) {
  return (
    <Box component="li" sx={{ listStyle: 'none', position: 'relative', borderTop: 1, borderColor: 'divider' }}>
      <Box
        component={RouterLink}
        to={item.to}
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr auto', sm: '136px minmax(0, 1fr) auto' },
          columnGap: 2, rowGap: 0.25, alignItems: 'center',
          py: 1.75, pl: 3, pr: { xs: 2, sm: 2.5 },
          color: 'text.primary', textDecoration: 'none',
          '&:hover': { bgcolor: 'action.hover' },
          '&:hover .queue-action': { textDecoration: 'underline', textUnderlineOffset: 3 },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
          '&::before': {
            content: '""', position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
            bgcolor: RAIL_COLORS[item.tone],
          },
        }}
      >
        <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
          <Typography component="span" sx={{ fontWeight: 600, color: TEXT_COLORS[item.tone], lineHeight: 1.25, display: 'block' }}>
            {item.headline}
          </Typography>
          {item.dateLabel && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
              {item.dateLabel}
            </Typography>
          )}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{item.title}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>{item.subtitle}</Typography>
        </Box>
        <Box sx={{ textAlign: 'right', minWidth: { sm: 150 } }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {item.amount == null ? item.amountCaption : formatCurrency(item.amount)}
          </Typography>
          <Typography className="queue-action" variant="body2" color="primary.main" sx={{ fontWeight: 600 }}>
            {item.actionLabel}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

export default function NeedsActionQueue({ items, loading, incomplete }) {
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(false)

  const billingCount = items.filter((item) => item.group === 'billing').length
  const calendarCount = items.length - billingCount
  const filtered = filter === 'all' ? items : items.filter((item) => item.group === filter)
  const visible = expanded ? filtered : filtered.slice(0, QUEUE_PREVIEW_LIMIT)
  const hiddenCount = filtered.length - visible.length

  return (
    <Box sx={{ pt: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5, px: 2.5, pb: 1.5 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>Needs action</Typography>
        <Typography variant="caption" color="text.secondary">Most urgent first</Typography>
      </Box>

      <ToggleButtonGroup
        value={filter} exclusive size="small" aria-label="Filter actions"
        onChange={(_, value) => { if (value) { setFilter(value); setExpanded(false) } }}
        sx={{
          px: 2, pb: 1.5, gap: 0.5, flexWrap: 'wrap',
          '& .MuiToggleButton-root': {
            border: 0, borderRadius: 999, px: 1.5, py: 0.5, textTransform: 'none', fontWeight: 500,
            '&.Mui-selected': { bgcolor: 'primary.light', color: 'primary.main', fontWeight: 600 },
          },
          '& .MuiToggleButtonGroup-grouped:not(:first-of-type)': { borderRadius: 999, ml: 0 },
          '& .MuiToggleButtonGroup-grouped:not(:last-of-type)': { borderRadius: 999 },
        }}
      >
        <ToggleButton value="all">All {items.length}</ToggleButton>
        <ToggleButton value="billing">Billing {billingCount}</ToggleButton>
        <ToggleButton value="calendar">Calendar {calendarCount}</ToggleButton>
      </ToggleButtonGroup>

      {incomplete && (
        <Alert severity="warning" sx={{ mx: 2.5, mb: 1.5 }}>
          Some data did not load, so this list may be incomplete.
        </Alert>
      )}

      {loading && items.length === 0 ? (
        <Skeleton variant="rounded" height={260} sx={{ mx: 2.5, mb: 2.5 }} />
      ) : filtered.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ borderTop: 1, borderColor: 'divider', px: 2.5, py: 5, textAlign: 'center' }}>
          {items.length === 0
            ? 'Nothing needs action. No cutoffs to bill, overdue invoices or unscheduled Phases.'
            : 'Nothing in this group needs action.'}
        </Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0 }}>
          {visible.map((item) => <QueueRow key={item.id} item={item} />)}
        </Box>
      )}

      {(hiddenCount > 0 || (expanded && filtered.length > QUEUE_PREVIEW_LIMIT)) && (
        <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1.5, py: 0.75 }}>
          <Button size="small" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Show fewer' : `Show ${hiddenCount} more`}
          </Button>
        </Box>
      )}
    </Box>
  )
}
