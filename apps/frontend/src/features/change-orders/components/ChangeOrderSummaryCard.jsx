import { Box, Divider, Paper, Typography } from '@mui/material'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import HomeWorkOutlinedIcon from '@mui/icons-material/HomeWorkOutlined'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'

import { useBuilders } from '../../builders/context/useBuilders.js'
import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { coverageModes } from '../data/changeOrders.js'
import { useChangeOrderCoverage } from '../hooks/useChangeOrderCoverage.js'
import ChangeOrderStatusChip from './ChangeOrderStatusChip.jsx'

const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`

function SummaryRow({ label, children }) {
  const empty = children === '' || children == null

  return (
    <>
      <Typography component="dt" variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        component="dd"
        variant="body2"
        sx={{ m: 0, fontWeight: 500, overflowWrap: 'anywhere' }}
        color={empty ? 'text.disabled' : 'text.primary'}
      >
        {empty ? '—' : children}
      </Typography>
    </>
  )
}

function Figure({ icon, value, label }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
      {icon}
      <Typography component="span" variant="body2" color="text.primary" fontWeight={700}>
        {value}
      </Typography>
      <Typography component="span" variant="body2">{label}</Typography>
    </Box>
  )
}

/** The Extra / Change Order as it is filled in; it updates with every choice. */
export default function ChangeOrderSummaryCard({ values }) {
  const { builders } = useBuilders()
  const { job, summary, amounts } = useChangeOrderCoverage(values)

  const perLot = amounts.priced === 0
    ? ''
    : amounts.min === amounts.max
      ? formatCurrency(amounts.min)
      : `${formatCurrency(amounts.min)} – ${formatCurrency(amounts.max)}`
  const builder = builders.find((item) => String(item.id) === String(values.builderId))
  const coverage = coverageModes.find((item) => item.value === values.coverageMode)
  const placeIssues = [
    amounts.places.unnamed > 0 && `${amounts.places.unnamed} without a place`,
    amounts.places.unpriced > 0 && `${amounts.places.unpriced} without an amount`,
    amounts.places.withoutScope > 0 && `${amounts.places.withoutScope} without a Scope of Work`,
  ].filter(Boolean)

  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Extra / CO summary"
      sx={{ borderRadius: 2, overflow: 'hidden' }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2.5,
          py: 1.75,
          bgcolor: 'primary.light',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <ReceiptLongOutlinedIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" component="h2" fontWeight={700}>
          Extra / CO Summary
        </Typography>
      </Box>

      <Box sx={{ p: 2.5 }}>
        <Box
          component="dl"
          sx={{
            m: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(88px, auto) 1fr',
            columnGap: 2,
            rowGap: 1.5,
            alignItems: 'baseline',
          }}
        >
          <SummaryRow label="Internal #">{values.internalNumber}</SummaryRow>
          <SummaryRow label="Title">{values.title}</SummaryRow>
          <SummaryRow label="Builder">{builder?.name}</SummaryRow>
          <SummaryRow label="Community">{values.community}</SummaryRow>
          <SummaryRow label="Job">{job ? `#${job.code}` : ''}</SummaryRow>
          <SummaryRow label="Status">
            <ChangeOrderStatusChip status={values.status} />
          </SummaryRow>
          <SummaryRow label="Coverage">{coverage?.label}</SummaryRow>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Total Affected
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 1 }}>
          <Figure
            icon={<HomeWorkOutlinedIcon fontSize="small" />}
            value={summary.lots}
            label={summary.lots === 1 ? 'Lot' : 'Lots'}
          />
          <Figure
            icon={<LayersOutlinedIcon fontSize="small" />}
            value={summary.phases}
            label={summary.phases === 1 ? 'Phase' : 'Phases'}
          />
          <Figure
            icon={<ApartmentRoundedIcon fontSize="small" />}
            value={summary.buildings}
            label={summary.buildings === 1 ? 'Building' : 'Buildings'}
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box
          component="dl"
          sx={{
            m: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(88px, auto) 1fr',
            columnGap: 2,
            rowGap: 1.5,
            alignItems: 'baseline',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <SummaryRow label="Amount per Lot">{perLot}</SummaryRow>
          <SummaryRow label="Own values">
            {amounts.own === 0 ? '' : plural(amounts.own, 'lot')}
          </SummaryRow>
          <SummaryRow label="Without a lot">
            {amounts.places.count === 0 ? '' : plural(amounts.places.count, 'line')}
          </SummaryRow>
          <SummaryRow label="Total Amount">
            {amounts.total === null ? '' : <strong>{formatCurrency(amounts.total)}</strong>}
          </SummaryRow>
        </Box>

        {amounts.unpriced > 0 && (
          <Typography variant="caption" color="warning.main" component="p" sx={{ mt: 1.5 }}>
            {plural(amounts.unpriced, 'lot')} without an amount yet.
          </Typography>
        )}
        {amounts.withoutScope > 0 && (
          <Typography variant="caption" color="warning.main" component="p" sx={{ mt: 0.5 }}>
            {plural(amounts.withoutScope, 'lot')} without a Scope of Work yet.
          </Typography>
        )}
        {placeIssues.length > 0 && (
          <Typography variant="caption" color="warning.main" component="p" sx={{ mt: 0.5 }}>
            Lines without a lot: {placeIssues.join(', ')}.
          </Typography>
        )}
      </Box>
    </Paper>
  )
}
