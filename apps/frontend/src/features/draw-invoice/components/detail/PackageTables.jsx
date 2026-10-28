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
import { worksheetCellLabels } from '../../utils/packageInvoiceLabel.js'
import { formatPhaseBuilding } from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import {
  buildBilledUtilityCharges,
  buildUsedDrawSelections,
  drawSelectionKey,
  utilityChargeKey,
} from '../../utils/drawPackages.js'
import {
  formatCurrency,
  formatOptionPrice,
  formatPercentage,
} from '../../utils/drawInvoiceFormatters.js'
import { formatLagShort } from '../../../builder-draw-schedules/utils/drawLag.js'
import PurchaseOrderBackingChip from '../../../purchase-orders/components/PurchaseOrderBackingChip.jsx'
import { TableCardHeader } from '../shared/PackageUi.jsx'
import { packageTableSx } from '../shared/packageTableStyles.js'

// The key to the worksheet's cell colours: a swatch and what it means.
function LegendSwatch({ label, sx }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Box
        aria-hidden
        sx={{ width: 14, height: 14, borderRadius: 0.5, border: 1, borderColor: 'divider', ...sx }}
      />
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Stack>
  )
}

const currentSwatchSx = {
  bgcolor: 'warning.light',
  boxShadow: (theme) => `inset 3px 0 0 ${theme.palette.warning.dark}`,
}
const earlierSwatchSx = { bgcolor: 'primary.light' }

export function DrawWorksheetTable({
  job,
  phase,
  worksheet,
  packages,
  currentPackageId,
  phaseHeading = null,
}) {
  const minimumWidth = 300 + worksheet.draws.length * 230
  const usedSelections = useMemo(
    () => buildUsedDrawSelections(packages),
    [packages],
  )
  const billedUtilityCharges = useMemo(
    () => buildBilledUtilityCharges(packages, job.id),
    [job.id, packages],
  )

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <TableCardHeader
        title={(
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {phaseHeading && <Chip size="small" color="primary" label={phaseHeading} sx={{ fontWeight: 800 }} />}
            <span>Draw worksheet</span>
          </Stack>
        )}
        chip={(
          <Chip
            size="small"
            variant="outlined"
            label={`${worksheet.rows.length} ${worksheet.rows.length === 1 ? 'row' : 'rows'}`}
          />
        )}
      >
        <Stack direction="row" spacing={2} useFlexGap sx={{ mt: 0.5, flexWrap: 'wrap' }}>
          {currentPackageId != null && (
            <LegendSwatch label="Billed in this Package" sx={currentSwatchSx} />
          )}
          <LegendSwatch
            label={currentPackageId != null ? 'Billed in an earlier Package' : 'Already billed in a Package'}
            sx={earlierSwatchSx}
          />
          <LegendSwatch label="Available" />
        </Stack>
        {worksheet.utilityBuildingEnabled && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Utility follows this Job&apos;s 100% or event-based Builder Setup.
          </Typography>
        )}
      </TableCardHeader>
      <TableContainer>
        <Table
          size="medium"
          aria-label={`${formatPhaseBuilding(phase.name, phase.building, { separator: ' ' })} draw worksheet`}
          sx={{
            ...packageTableSx,
            minWidth: minimumWidth,
            '& .MuiTableCell-root': { px: 1.2, py: 1, fontSize: 12.25, fontVariantNumeric: 'tabular-nums' },
            '& .MuiTableHead-root .MuiTableCell-head.draw-heading': { bgcolor: 'primary.light' },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell rowSpan={2} sx={{ width: 60, fontWeight: 800 }}>
                Lot / Utility
              </TableCell>
              <TableCell rowSpan={2} sx={{ width: 72, fontWeight: 800 }}>Plan</TableCell>
              <TableCell rowSpan={2} align="right" sx={{ width: 115, fontWeight: 800 }}>
                Plan Price
              </TableCell>
              {worksheet.draws.map((draw, drawIndex) => (
                <TableCell
                  key={`draw-heading-${drawIndex}`}
                  className="draw-heading"
                  colSpan={2}
                  align="center"
                  sx={{ borderLeft: 1, borderColor: 'divider' }}
                >
                  <Typography color="primary.main" fontWeight={850}>
                    Draw #{drawIndex + 1}
                    {draw.name?.trim() ? ` · ${draw.name.trim()}` : ''}
                  </Typography>
                  <Typography variant="caption" color="primary.main" fontWeight={750} sx={{ display: 'block' }}>
                    {formatPercentage(draw.percentage)}%
                    {draw.lag ? ` · ${draw.eventType} ${formatLagShort(draw.lag)}` : ''}
                  </Typography>
                  {worksheet.utilityBuildingEnabled && (
                    <Typography variant="caption" color="primary.main" fontWeight={750} sx={{ display: 'block' }}>
                      Utility{' '}
                      {worksheet.utilityBillingMode === 'BY_EVENT'
                        ? `${formatPercentage(
                            worksheet.rows.find((row) => row.isUtilityBuilding)
                              ?.utilityPercentages?.[drawIndex] ?? 0,
                          )}%`
                        : '100% selectable'}
                    </Typography>
                  )}
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
                  <Typography color={row.isUtilityBuilding ? 'primary.main' : 'error.main'} fontWeight={850}>
                    {row.utilityLabel ?? row.lotNumber}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography fontWeight={750}>{row.planCode ?? '—'}</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={750}>{formatCurrency(row.drawBasePrice)}</Typography>
                </TableCell>
                {worksheet.draws.flatMap((_, drawIndex) => {
                  const key = drawSelectionKey(job.id, phase.id, row.id, drawIndex)
                  const exactOwner = usedSelections.get(key)
                  const utilityOwner = row.isUtilityBuilding
                    ? billedUtilityCharges.get(utilityChargeKey(
                        row.id,
                        worksheet.utilityBillingMode,
                        worksheet.draws[drawIndex]?.eventType,
                      ))
                    : null
                  const owner = exactOwner ?? utilityOwner
                  // The invoice number and how the invoice stands; the Package
                  // number and what is missing until the invoice exists.
                  const ownerLabels = owner
                    ? worksheetCellLabels(
                      owner,
                      utilityOwner && !exactOwner
                        ? `Billed on Draw #${utilityOwner.drawIndex + 1}`
                        : 'Invoice pending',
                    )
                    : null
                  const isCurrent = currentPackageId != null
                    && (owner?.id === currentPackageId || owner?.packageId === currentPackageId)

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
                          ? isCurrent
                            // Billed in the Package on screen: yellow, with an accent.
                            ? {
                                bgcolor: 'warning.light',
                                color: 'warning.contrastText',
                                boxShadow: (theme) => `inset 3px 0 0 ${theme.palette.warning.dark}`,
                              }
                            // Billed in an earlier Package: the calm blue of the app.
                            : {
                                bgcolor: 'primary.light',
                                color: 'primary.main',
                              }
                          : undefined
                      }
                    >
                      {owner ? (
                        <Box>
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                            <LockRoundedIcon sx={{ fontSize: 14 }} />
                            <Typography variant="caption" fontWeight={850}>
                              {ownerLabels.title}
                            </Typography>
                          </Stack>
                          <Typography variant="caption" component="div">
                            {ownerLabels.subtitle}
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

export function PackageUtilityTable({ summary }) {
  const utilityRows = summary.utilityRows ?? []
  if (utilityRows.length === 0) return null

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <TableCardHeader
        title="Utility Building"
        description="Utility Plan Price charges included in this package."
        chip={(
          <Chip
            size="small"
            variant="outlined"
            label={`Total · ${formatCurrency(summary.utilityTotal)}`}
          />
        )}
      />
      <TableContainer>
        <Table size="small" aria-label="Utility Building charges in this package" sx={packageTableSx}>
          <TableHead>
            <TableRow>
              <TableCell>Phase</TableCell>
              <TableCell>Utility</TableCell>
              <TableCell>Plan</TableCell>
              <TableCell>Billing trigger</TableCell>
              <TableCell align="right">Plan Price</TableCell>
              <TableCell align="right">Allocation</TableCell>
              <TableCell align="right">Charged</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {utilityRows.map((row) => (
              <TableRow key={`${row.phaseId}:${row.lotId}:${row.drawIndex}`} hover>
                <TableCell>
                  {formatPhaseBuilding(row.phaseCode, row.building, { separator: ' / ' })}
                </TableCell>
                <TableCell><Typography fontWeight={850}>{row.utilityLabel}</Typography></TableCell>
                <TableCell>{row.planCode ?? '—'}</TableCell>
                <TableCell>
                  <Typography fontWeight={750}>
                    Draw #{row.drawIndex + 1}
                    {row.drawName?.trim() ? ` · ${row.drawName.trim()}` : ''}
                    {row.utilityEventType || row.eventType
                      ? ` · ${row.utilityEventType ?? row.eventType}`
                      : ''}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {formatCurrency(row.basePrice ?? row.utilityAmount)}
                </TableCell>
                <TableCell align="right">
                  {formatPercentage(row.utilityPercentage || 100)}%
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={850}>{formatCurrency(row.utilityAmount)}</Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={6}><Typography fontWeight={850}>Utility total</Typography></TableCell>
              <TableCell align="right">
                <Typography fontWeight={900}>{formatCurrency(summary.utilityTotal)}</Typography>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>
    </Card>
  )
}

export function PackageOptionsTable({ summary, backing = null }) {
  const showBacking = Boolean(backing?.hasPurchaseOrders)
  const availableFromDrawLabel = summary.optionsBillingDrawIndex == null
    ? 'Not configured'
    : `Draw #${summary.optionsBillingDrawIndex + 1}`
  const chargedOptionRows = summary.chargedOptionRows ?? summary.selectedOptionRows
  // What this package charges comes first, then what earlier packages charged.
  const currentRows = chargedOptionRows.filter((option) => option.chargedInCurrentPackage)
  const previousRows = chargedOptionRows.filter((option) => !option.chargedInCurrentPackage)

  const renderTable = (rows, { label, total = false }) => (
    <TableContainer>
      <Table size="small" aria-label={label} sx={packageTableSx}>
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
            {showBacking && <TableCell>Purchase Order</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((option) => {
            const priceMissing = option.issue === 'PRICE_MISSING'

            return (
              <TableRow key={option.id} hover>
                <TableCell>
                  {formatPhaseBuilding(option.phaseCode, option.building, { separator: ' / ' })}
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
                    {priceMissing ? 'Price missing' : formatOptionPrice(option.price, option.priceNotApplicable)}
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
                {showBacking && (
                  <TableCell>
                    <PurchaseOrderBackingChip result={backing.lookup(option)} />
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
        {total && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={6}>
                <Typography fontWeight={850}>Options total in this package</Typography>
              </TableCell>
              <TableCell align="right">
                <Typography fontWeight={900}>{formatCurrency(summary.optionsTotal)}</Typography>
              </TableCell>
              <TableCell />
              {showBacking && <TableCell />}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </TableContainer>
  )

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <TableCardHeader
        title="Options"
        description="Options charged for this Job through the current package."
        chip={(
          <Chip
            size="small"
            variant="outlined"
            label={`Available from · ${availableFromDrawLabel}`}
          />
        )}
      />

      {summary.optionsBillingDrawIndex == null ? (
        <Alert severity="info" sx={{ m: 2 }}>
          This builder does not have an options billing draw configured.
        </Alert>
      ) : chargedOptionRows.length === 0 ? (
        <Alert severity="info" sx={{ m: 2 }}>
          No options had been charged for this Job when this package was created.
        </Alert>
      ) : (
        <>
          {currentRows.length > 0 ? renderTable(currentRows, {
            label: 'Options charged through this package',
            total: true,
          }) : (
            <Alert severity="info" sx={{ m: 2 }}>
              This package does not charge any option.
            </Alert>
          )}
          {previousRows.length > 0 && (
            <>
              <Divider />
              <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5, bgcolor: 'action.hover' }}>
                <Typography fontWeight={800}>Charged previously</Typography>
                <Typography variant="body2" color="text.secondary">
                  {previousRows.length} {previousRows.length === 1 ? 'option' : 'options'} billed
                  in earlier packages of this Job. They are not part of this package's total.
                </Typography>
              </Box>
              <Divider />
              {renderTable(previousRows, { label: 'Options charged in earlier packages' })}
            </>
          )}
        </>
      )}
    </Card>
  )
}

export function PackageHardwareTable({ summary }) {
  const hardwareRows = summary.hardwareRows ?? []

  if (!summary.separateHardwarePrice || !summary.hardwareIsDue) return null

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <TableCardHeader
        title="Hardware"
        description="Separate hardware prices included in this package."
        chip={(
          <Chip
            size="small"
            variant="outlined"
            label={`${hardwareRows.length} ${hardwareRows.length === 1 ? 'charge' : 'charges'}`}
          />
        )}
      />
      <TableContainer>
        <Table size="small" aria-label="Separate hardware charged in this package" sx={packageTableSx}>
          <TableHead>
            <TableRow>
              <TableCell>Phase</TableCell>
              <TableCell>Lot</TableCell>
              <TableCell>Plan</TableCell>
              <TableCell>Billing draw</TableCell>
              <TableCell>Allocation</TableCell>
              <TableCell align="right">Price</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {hardwareRows.map((hardware) => (
              <TableRow
                key={hardware.id
                  ?? `${hardware.phaseId}:${hardware.lotId}:${hardware.hardwareEventType ?? hardware.drawIndex}`}
                hover
              >
                <TableCell>
                  {formatPhaseBuilding(hardware.phaseCode, hardware.building, { separator: ' / ' })}
                </TableCell>
                <TableCell>
                  <Typography color="error.main" fontWeight={850}>
                    {hardware.lotNumber}
                  </Typography>
                </TableCell>
                <TableCell>{hardware.planCode ?? '—'}</TableCell>
                <TableCell>
                  <Typography fontWeight={750}>
                    {hardware.hardwareBillingMode === 'BY_EVENT'
                      ? `${hardware.hardwareEventType} Calendar event`
                      : `Draw #${hardware.drawIndex + 1}${hardware.drawName?.trim()
                        ? ` · ${hardware.drawName.trim()}`
                        : ''}`}
                  </Typography>
                </TableCell>
                <TableCell>
                  {hardware.hardwareBillingMode === 'BY_EVENT'
                    ? `${hardware.hardwareEventType} · ${hardware.hardwarePercentage}%`
                    : '100% full'}
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={750}>
                    {formatCurrency(hardware.hardwareAmount)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip size="small" color="success" label="Included in this package" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5}>
                <Typography fontWeight={850}>Hardware total in this package</Typography>
              </TableCell>
              <TableCell align="right">
                <Typography fontWeight={900}>
                  {formatCurrency(summary.hardwareTotal)}
                </Typography>
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>
    </Card>
  )
}
