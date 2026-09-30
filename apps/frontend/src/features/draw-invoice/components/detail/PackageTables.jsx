import { useMemo } from 'react'
import {
  Alert,
  Box,
  Card,
  Chip,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import {
  formatBuilding,
  formatPhase,
} from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import {
  buildUsedDrawSelections,
  drawSelectionKey,
} from '../../utils/drawPackages.js'
import {
  formatCurrency,
  formatDate,
  formatPercentage,
} from '../../utils/drawInvoiceFormatters.js'

export function DrawWorksheetTable({
  job,
  phase,
  worksheet,
  packages,
  currentPackageId,
}) {
  const minimumWidth = 300 + worksheet.draws.length * 230
  const usedSelections = useMemo(
    () => buildUsedDrawSelections(packages),
    [packages],
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
            <Typography fontWeight={800}>Draw worksheet</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Yellow cells are already assigned to an invoice package and cannot
              be selected again.
            </Typography>
          </Box>
          <Chip
            size="small"
            variant="outlined"
            label={`${worksheet.rows.length} ${worksheet.rows.length === 1 ? 'lot' : 'lots'}`}
          />
        </Stack>
      </Box>
      <Divider />
      <TableContainer>
        <Table
          size="medium"
          aria-label={`${formatPhase(phase.name)} ${formatBuilding(phase.building)} draw worksheet`}
          sx={{
            minWidth: minimumWidth,
            '& .MuiTableCell-root': { px: 1.2, py: 1, fontSize: 12.25 },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell rowSpan={2} sx={{ width: 60, fontWeight: 800 }}>Lot</TableCell>
              <TableCell rowSpan={2} sx={{ width: 72, fontWeight: 800 }}>Plan</TableCell>
              <TableCell rowSpan={2} align="right" sx={{ width: 115, fontWeight: 800 }}>
                {worksheet.separateHardwarePrice ? 'Draw base / lot' : 'Price per lot'}
              </TableCell>
              {worksheet.draws.map((draw, drawIndex) => (
                <TableCell
                  key={`draw-heading-${drawIndex}`}
                  colSpan={2}
                  align="center"
                  sx={{ borderLeft: 1, borderColor: 'divider', bgcolor: 'primary.light' }}
                >
                  <Typography color="primary.main" fontWeight={850}>
                    Draw #{drawIndex + 1}
                    {draw.name?.trim() ? ` · ${draw.name.trim()}` : ''}
                  </Typography>
                  <Typography variant="caption" color="primary.main" fontWeight={750}>
                    {formatPercentage(draw.percentage)}%
                  </Typography>
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              {worksheet.draws.flatMap((_, drawIndex) => [
                <TableCell
                  key={`amount-heading-${drawIndex}`}
                  align="right"
                  sx={{ width: 98, borderLeft: 1, borderColor: 'divider', fontWeight: 750 }}
                >
                  Amount
                </TableCell>,
                <TableCell key={`invoice-heading-${drawIndex}`} sx={{ width: 132, fontWeight: 750 }}>
                  Package / Invoice
                </TableCell>,
              ])}
            </TableRow>
          </TableHead>
          <TableBody>
            {worksheet.rows.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell>
                  <Typography color="error.main" fontWeight={850}>{row.lotNumber}</Typography>
                </TableCell>
                <TableCell>
                  <Typography fontWeight={750}>{row.planCode ?? '—'}</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={750}>{formatCurrency(row.drawBasePrice)}</Typography>
                </TableCell>
                {worksheet.draws.flatMap((_, drawIndex) => {
                  const key = drawSelectionKey(job.id, phase.id, row.id, drawIndex)
                  const owner = usedSelections.get(key)
                  const isCurrent = owner?.id === currentPackageId

                  return [
                    <TableCell
                      key={`${key}-amount`}
                      align="right"
                      sx={{ borderLeft: 1, borderColor: 'divider' }}
                    >
                      <Typography fontWeight={850}>
                        {formatCurrency(row.drawAmounts[drawIndex])}
                      </Typography>
                    </TableCell>,
                    <TableCell
                      key={`${key}-usage`}
                      sx={
                        owner
                          ? {
                              bgcolor: 'warning.light',
                              color: 'warning.contrastText',
                              boxShadow: isCurrent ? 'inset 3px 0 0' : undefined,
                              boxShadowColor: isCurrent ? 'warning.dark' : undefined,
                            }
                          : undefined
                      }
                    >
                      {owner ? (
                        <Box>
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                            <LockRoundedIcon sx={{ fontSize: 14 }} />
                            <Typography variant="caption" fontWeight={850}>
                              {owner.packageNumber}
                            </Typography>
                          </Stack>
                          <Typography variant="caption" component="div">
                            {owner.invoiceNumber
                              ? `${owner.invoiceNumber} · ${formatDate(owner.invoiceDate)}`
                              : 'Invoice pending'}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">Available</Typography>
                      )}
                    </TableCell>,
                  ]
                })}
              </TableRow>
            ))}
          </TableBody>
          {worksheet.rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}><Typography fontWeight={850}>Worksheet total</Typography></TableCell>
                <TableCell align="right"><Typography fontWeight={850}>{formatCurrency(worksheet.totalDrawBasePrice)}</Typography></TableCell>
                {worksheet.draws.flatMap((_, drawIndex) => {
                  const usedCount = worksheet.rows.filter((row) =>
                    usedSelections.has(drawSelectionKey(job.id, phase.id, row.id, drawIndex)),
                  ).length
                  return [
                    <TableCell key={`total-${drawIndex}`} align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>
                      <Typography fontWeight={900}>{formatCurrency(worksheet.drawTotals[drawIndex])}</Typography>
                    </TableCell>,
                    <TableCell key={`used-${drawIndex}`}>
                      <Typography variant="caption" color="text.secondary">
                        {usedCount} / {worksheet.rows.length} used
                      </Typography>
                    </TableCell>,
                  ]
                })}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </TableContainer>
    </Card>
  )
}

export function PackageOptionsTable({ summary }) {
  const availableFromDrawLabel = summary.optionsBillingDrawIndex == null
    ? 'Not configured'
    : `Draw #${summary.optionsBillingDrawIndex + 1}`
  const chargedOptionRows = summary.chargedOptionRows ?? summary.selectedOptionRows

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 2, bgcolor: 'action.hover' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Box>
            <Typography fontWeight={800}>Options</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Options charged for this Job through the current package.
            </Typography>
          </Box>
          <Chip
            size="small"
            variant="outlined"
            label={`Available from · ${availableFromDrawLabel}`}
          />
        </Stack>
      </Box>
      <Divider />

      {summary.optionsBillingDrawIndex == null ? (
        <Alert severity="info" sx={{ m: 2 }}>
          This builder does not have an options billing draw configured.
        </Alert>
      ) : chargedOptionRows.length === 0 ? (
        <Alert severity="info" sx={{ m: 2 }}>
          No options had been charged for this Job when this package was created.
        </Alert>
      ) : (
        <TableContainer>
          <Table size="small" aria-label="Options charged through this package">
            <TableHead>
              <TableRow>
                <TableCell>Phase</TableCell>
                <TableCell>Lot</TableCell>
                <TableCell>Plan</TableCell>
                <TableCell>Option</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Charged with</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {chargedOptionRows.map((option) => {
                const priceMissing = option.issue === 'PRICE_MISSING'

                return (
                  <TableRow key={option.id} hover>
                    <TableCell>
                      {formatPhase(option.phaseCode)} / {formatBuilding(option.building)}
                    </TableCell>
                    <TableCell>
                      <Typography color="error.main" fontWeight={850}>
                        {option.lotNumber}
                      </Typography>
                    </TableCell>
                    <TableCell>{option.planCode ?? '—'}</TableCell>
                    <TableCell><Typography fontWeight={750}>{option.optionCode}</Typography></TableCell>
                    <TableCell>{option.description}</TableCell>
                    <TableCell>
                      <Typography fontWeight={750}>
                        {option.chargedPackageNumber ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography color={priceMissing ? 'error' : 'text.primary'} fontWeight={750}>
                        {priceMissing ? 'Price missing' : formatCurrency(option.price)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={priceMissing ? 'error' : 'success'}
                        variant={option.chargedInCurrentPackage ? 'filled' : 'outlined'}
                        label={priceMissing
                          ? 'Needs price'
                          : option.chargedInCurrentPackage
                            ? 'Included in this package'
                            : 'Charged previously'}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography fontWeight={850}>Options total in this package</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={900}>{formatCurrency(summary.optionsTotal)}</Typography>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </TableContainer>
      )}
    </Card>
  )
}
