import {
  Box,
  Card,
  Checkbox,
  Chip,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import BilledRowsAccordion from './BilledRowsAccordion.jsx'
import { utilityChargeKey } from '../../utils/drawPackages.js'
import {
  formatCurrency,
  formatLongDate,
  formatPercentage,
} from '../../utils/drawInvoiceFormatters.js'

const UTILITY_EVENTS = ['EXT', 'DM', 'HW']

/** Why a Utility share is checked, or why it waits. */
function shareStatus(candidate, billed) {
  if (billed) return `Charged · ${billed.packageNumber}`
  if (!candidate) return 'Not charged'
  if (candidate.checked) {
    if (candidate.isRelated) return 'Will be charged · event selected'
    if (candidate.isCalendarSuggested) return 'Will be charged · in the Calendar'
    return 'Will be charged'
  }
  if (candidate.isRelated || candidate.isCalendarSuggested) return 'Suggested · not charged'
  return candidate.eventDate ? 'Not charged' : 'Not in the Calendar yet'
}

// `utilityEventCandidates` are this Phase's Utility shares by Calendar event, from the dialog: each
// { lotId, eventType, eventDate, isRelated, isCalendarSuggested, checked }.
export default function CreatePackageUtilityTable({
  phase,
  worksheet,
  selectedUtilitySelections = [],
  utilityEventCandidates = [],
  billedUtilityCharges,
  fullUtilityRowIds = [],
  fullUtilityAnchorDrawIndex,
  onToggleFull,
  onToggleSplit,
}) {
  if (!phase || worksheet.rows.length === 0) return null

  const isSplit = worksheet.utilityBillingMode === 'BY_EVENT'
  const candidateByKey = new Map(utilityEventCandidates.map((candidate) => [
    `${candidate.lotId}:${candidate.eventType}`,
    candidate,
  ]))
  const eventColumns = UTILITY_EVENTS
    .filter((eventType) => Number(worksheet.rows[0]?.utilityEventPercentages?.[eventType]) > 0)
    .map((eventType) => ({
      eventType,
      percentage: Number(worksheet.rows[0]?.utilityEventPercentages?.[eventType]) || 0,
      // The first day the Calendar has the event on a Lot of this Phase.
      eventDate: utilityEventCandidates.find(
        (candidate) => candidate.eventType === eventType && candidate.eventDate,
      )?.eventDate ?? null,
    }))
  const selectedCount = isSplit
    ? utilityEventCandidates.filter((candidate) => candidate.checked).length
    : selectedUtilitySelections.length

  // A row with every one of its charges billed has nothing left to choose.
  const isFullyBilled = (row) => (isSplit
    ? eventColumns.length > 0 && eventColumns.every((column) => billedUtilityCharges.has(
      utilityChargeKey(row.id, 'BY_EVENT', column.eventType),
    ))
    : billedUtilityCharges.has(utilityChargeKey(row.id, 'FULL')))
  const pendingRows = worksheet.rows.filter((row) => !isFullyBilled(row))
  const billedRows = worksheet.rows.filter(isFullyBilled)

  // The same table for what is still to choose and for what was already billed.
  const renderTable = (rows, label) => (
    <TableContainer>
      <Table
        size="small"
        aria-label={label}
        sx={{ minWidth: isSplit ? 420 + eventColumns.length * 190 : 720 }}
      >
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 800 }}>Utility</TableCell>
            <TableCell sx={{ fontWeight: 800 }}>Plan</TableCell>
            <TableCell align="right" sx={{ fontWeight: 800 }}>Plan Price</TableCell>
            {isSplit ? eventColumns.map((column) => (
              <TableCell
                key={column.eventType}
                align="center"
                sx={{ minWidth: 190, bgcolor: 'primary.light', color: 'primary.main' }}
              >
                <Typography variant="caption" fontWeight={800} component="div">
                  {column.eventDate
                    ? `${column.eventType} (${formatLongDate(column.eventDate)})`
                    : column.eventType}
                </Typography>
                <Typography fontWeight={850}>
                  {formatPercentage(column.percentage)}% configured
                </Typography>
              </TableCell>
            )) : (
              <>
                <TableCell align="center" sx={{ fontWeight: 800 }}>Charge</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Status</TableCell>
              </>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const fullCharge = billedUtilityCharges.get(
              utilityChargeKey(row.id, 'FULL'),
            )
            const fullChecked = fullUtilityRowIds.includes(String(row.id))
              && fullUtilityAnchorDrawIndex !== null
            return (
              <TableRow key={row.id} hover>
                <TableCell>
                  <Typography fontWeight={850}>{row.utilityLabel}</Typography>
                </TableCell>
                <TableCell>
                  <Typography fontWeight={750}>{row.planCode ?? '—'}</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={850}>{formatCurrency(row.basePrice)}</Typography>
                </TableCell>
                {isSplit ? eventColumns.map((column) => {
                  const chargeKey = utilityChargeKey(
                    row.id,
                    'BY_EVENT',
                    column.eventType,
                  )
                  const billed = billedUtilityCharges.get(chargeKey)
                  const candidate = candidateByKey.get(`${row.id}:${column.eventType}`)
                  return (
                    <TableCell key={column.eventType} align="center">
                      <Checkbox
                        size="small"
                        checked={Boolean(candidate?.checked)}
                        disabled={Boolean(billed) || !candidate}
                        onChange={() => onToggleSplit(row.id, column.eventType)}
                        slotProps={{ input: {
                          'aria-label': `Charge ${row.utilityLabel} ${column.eventType} Utility portion`,
                        } }}
                      />
                      <Typography variant="caption" component="div" fontWeight={750}>
                        {formatCurrency(billed?.utilityAmount ?? row.utilityEventAmounts?.[column.eventType])}
                      </Typography>
                      <Typography variant="caption" component="div" color="text.secondary">
                        {shareStatus(candidate, billed)}
                      </Typography>
                    </TableCell>
                  )
                }) : (
                  <>
                    <TableCell align="center">
                      <Checkbox
                        size="small"
                        checked={fullChecked}
                        disabled={Boolean(fullCharge)
                          || fullUtilityAnchorDrawIndex === null}
                        onChange={() => onToggleFull(row.id)}
                        slotProps={{ input: {
                          'aria-label': `Charge 100% of ${row.utilityLabel}`,
                        } }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={fullChecked ? 'primary' : 'default'}
                        variant={fullChecked ? 'filled' : 'outlined'}
                        label={fullCharge
                          ? `Charged · ${fullCharge.packageNumber}`
                          : fullUtilityAnchorDrawIndex === null
                            ? 'Select a Lot Draw first'
                            : fullChecked
                              ? 'Will be charged in this package'
                              : 'Not charged'}
                      />
                    </TableCell>
                  </>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 2, bgcolor: 'action.hover' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Box>
            <Typography fontWeight={800}>Utility Building</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {isSplit
                ? 'Each Calendar event bills its share of the Utility Plan Price. A share is suggested when a Lot Draw or Hardware of that event is chosen above, or when the Calendar has the event in this Phase. Uncheck any share that should wait for another package.'
                : 'Use Charge to add 100% of the Utility Plan Price to this package.'}
            </Typography>
          </Box>
          <Chip
            size="small"
            color={selectedCount > 0 ? 'primary' : 'default'}
            variant={selectedCount > 0 ? 'filled' : 'outlined'}
            label={`${selectedCount} ${selectedCount === 1 ? 'charge' : 'charges'} selected`}
          />
        </Stack>
      </Box>
      <Divider />
      {pendingRows.length > 0 ? renderTable(pendingRows, 'Choose Utility Building charges') : (
        <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Every Utility Building charge of this Phase was already billed.
            There is nothing pending.
          </Typography>
        </Box>
      )}
      <BilledRowsAccordion count={billedRows.length} nouns={['Utility row', 'Utility rows']}>
        {renderTable(billedRows, 'Utility Building charges already billed')}
      </BilledRowsAccordion>
    </Card>
  )
}
