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
import { utilityChargeKey } from '../../utils/drawPackages.js'
import {
  formatCurrency,
  formatLongDate,
  formatPercentage,
} from '../../utils/drawInvoiceFormatters.js'

function eventLabel(heading, fallback) {
  if (!heading?.eventType) return fallback
  if (heading.eventDates.length === 0) return heading.eventType
  return `${heading.eventType} (${formatLongDate(heading.eventDates[0])})`
}

export default function CreatePackageUtilityTable({
  phase,
  worksheet,
  drawCalendarHeadings = [],
  selectedUtilitySelections = [],
  selectedLotDrawIndexes = [],
  billedUtilityCharges,
  fullUtilityRowIds = [],
  fullUtilityAnchorDrawIndex,
  onToggleFull,
  onToggleSplit,
}) {
  if (!phase || worksheet.rows.length === 0) return null

  const isSplit = worksheet.utilityBillingMode === 'BY_EVENT'
  const selectedKeys = new Set(selectedUtilitySelections.map(
    ({ phaseId, lotId, drawIndex }) => `${phaseId}:${lotId}:${drawIndex}`,
  ))
  const eventColumns = [...new Set(worksheet.draws
    .filter((draw, drawIndex) => Number(
      worksheet.rows[0]?.utilityPercentages?.[drawIndex],
    ) > 0)
    .map((draw) => draw.eventType))]
    .map((eventType) => ({
      eventType,
      configuredDrawIndex: worksheet.draws.findIndex(
        (draw) => draw.eventType === eventType,
      ),
      selectedDrawIndex: selectedLotDrawIndexes.find(
        (drawIndex) => worksheet.draws[drawIndex]?.eventType === eventType,
      ),
    }))
  const selectedCount = selectedUtilitySelections.length

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
                ? 'Configured event portions are suggested from the Lot Draws selected above. Uncheck any portion that should wait for another package.'
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
      <TableContainer>
        <Table
          size="small"
          aria-label="Choose Utility Building charges"
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
                    {eventLabel(
                      drawCalendarHeadings[column.configuredDrawIndex],
                      column.eventType,
                    )}
                  </Typography>
                  <Typography fontWeight={850}>
                    {formatPercentage(
                      worksheet.rows[0]?.utilityPercentages?.[
                        column.configuredDrawIndex
                      ] ?? 0,
                    )}% configured
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
            {worksheet.rows.map((row) => {
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
                    const eligibleDrawIndex = column.selectedDrawIndex
                    const selected = eligibleDrawIndex !== undefined
                      && selectedKeys.has(
                        `${phase.id}:${row.id}:${eligibleDrawIndex}`,
                      )
                    const amountDrawIndex = eligibleDrawIndex
                      ?? column.configuredDrawIndex
                    return (
                      <TableCell key={column.eventType} align="center">
                        <Checkbox
                          size="small"
                          checked={selected}
                          disabled={Boolean(billed) || eligibleDrawIndex === undefined}
                          onChange={() => onToggleSplit(row.id, eligibleDrawIndex)}
                          inputProps={{
                            'aria-label': `Charge ${row.utilityLabel} ${column.eventType} Utility portion`,
                          }}
                        />
                        <Typography variant="caption" component="div" fontWeight={750}>
                          {formatCurrency(row.drawAmounts[amountDrawIndex])}
                        </Typography>
                        <Typography variant="caption" component="div" color="text.secondary">
                          {billed
                            ? `Charged · ${billed.packageNumber}`
                            : eligibleDrawIndex === undefined
                              ? 'Draw not selected'
                              : selected
                                ? 'Will be charged'
                                : 'Not charged'}
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
                          inputProps={{
                            'aria-label': `Charge 100% of ${row.utilityLabel}`,
                          }}
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
    </Card>
  )
}
