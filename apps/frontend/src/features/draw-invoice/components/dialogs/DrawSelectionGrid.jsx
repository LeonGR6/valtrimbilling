import {
  Box,
  Card,
  Checkbox,
  Chip,
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
import { formatLag, formatLagShort } from '../../../builder-draw-schedules/utils/drawLag.js'
import { drawSelectionKey } from '../../utils/drawPackages.js'
import { calendarSelectionKey } from '../../utils/calendarDrawSuggestions.js'
import {
  formatCurrency,
  formatLongDate,
  formatPercentage,
} from '../../utils/drawInvoiceFormatters.js'

function calendarHeadingLabel(heading) {
  if (!heading?.eventType) return 'Event not set'
  if (heading.eventDates.length === 0) return heading.eventType

  const firstDate = formatLongDate(heading.eventDates[0])
  const additionalDateCount = heading.eventDates.length - 1
  const lag = heading.lag ? ` ${formatLagShort(heading.lag)}` : ''
  return additionalDateCount > 0
    ? `${heading.eventType}${lag} (${firstDate} +${additionalDateCount} more)`
    : `${heading.eventType}${lag} (${firstDate})`
}

export default function DrawSelectionGrid({
  job,
  phase,
  worksheet,
  drawCalendarHeadings = [],
  usedSelections,
  selectedSelections,
  selectionIsUsed,
  selectionIsSelected,
  calendarReadySelectionKeys,
  suggestedSelectionKeys,
  toggleSelection,
  toggleLotSelections,
  toggleDrawSelections,
  // Optional: a cell that cannot be chosen for a reason other than belonging to
  // another Package, and the rows that the "select all" checkboxes may touch.
  cellDisabled = () => false,
  rowAllowsGroupSelection = () => true,
}) {
  const selectedLotKeys = [...new Set(
    selectedSelections.map(({ phaseId, lotId }) => `${phaseId}:${lotId}`),
  )]

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 1 }}
      >
        <Box>
          <Typography fontWeight={800}>Select Lot / Draw cells</Typography>
          <Typography variant="body2" color="text.secondary">
            Choose each cell independently. Yellow cells already belong to
            another Package.
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {suggestedSelectionKeys.size > 0 && (
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label={`${suggestedSelectionKeys.size} Calendar suggested`}
            />
          )}
          {calendarReadySelectionKeys.size > suggestedSelectionKeys.size && (
            <Chip
              size="small"
              color="info"
              variant="outlined"
              label={`${calendarReadySelectionKeys.size - suggestedSelectionKeys.size} also ready`}
            />
          )}
          <Chip
            size="small"
            color={selectedSelections.length > 0 ? 'primary' : 'default'}
            variant={selectedSelections.length > 0 ? 'filled' : 'outlined'}
            label={`${selectedSelections.length} ${selectedSelections.length === 1 ? 'cell' : 'cells'} selected`}
          />
        </Stack>
      </Stack>
      <Card variant="outlined" sx={{ overflow: 'hidden' }}>
        <TableContainer sx={{ maxHeight: 460 }}>
          <Table
            size="small"
            stickyHeader
            aria-label="Lot and Draw cells available for this package"
            sx={{
              minWidth: 300 + worksheet.draws.length * 185,
              '& .MuiTableCell-root': { px: 1.2, py: 1 },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell rowSpan={2} sx={{ width: 95, fontWeight: 800 }}>
                  Lot
                </TableCell>
                <TableCell rowSpan={2} sx={{ width: 90, fontWeight: 800 }}>
                  Plan
                </TableCell>
                <TableCell
                  rowSpan={2}
                  align="right"
                  sx={{ width: 115, fontWeight: 800 }}
                >
                  Price per lot
                </TableCell>
                {worksheet.draws.map((draw, drawIndex) => (
                  <TableCell
                    key={`select-draw-heading-${drawIndex}`}
                    align="center"
                    sx={{
                      minWidth: 185,
                      borderLeft: 1,
                      borderColor: 'divider',
                      bgcolor: 'primary.light',
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="primary.main"
                      fontWeight={800}
                      component="div"
                      title={drawCalendarHeadings[drawIndex]?.lag
                        ? `Billed ${formatLag(drawCalendarHeadings[drawIndex].lag)} after ${drawCalendarHeadings[drawIndex].eventType}. Available: ${(drawCalendarHeadings[drawIndex].availableDates ?? [])
                          .map(formatLongDate)
                          .join(' · ')}`
                        : (drawCalendarHeadings[drawIndex]?.eventDates ?? [])
                          .map(formatLongDate)
                          .join(' · ')}
                      sx={{ mb: 0.25, whiteSpace: 'normal' }}
                    >
                      {calendarHeadingLabel(drawCalendarHeadings[drawIndex])}
                    </Typography>
                    <Typography color="primary.main" fontWeight={850}>
                      Draw #{drawIndex + 1}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="primary.main"
                      fontWeight={750}
                      component="div"
                    >
                      {formatPercentage(draw.percentage)}%
                      {draw.name?.trim() ? ` · ${draw.name.trim()}` : ''}
                    </Typography>
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                {worksheet.draws.map((_, drawIndex) => {
                  const availableRows = worksheet.rows.filter(
                    (row) => rowAllowsGroupSelection(row)
                      && !selectionIsUsed(row.id, drawIndex)
                      && !cellDisabled(row, drawIndex),
                  )
                  const selectedCount = availableRows.filter(
                    (row) => selectionIsSelected(row.id, drawIndex),
                  ).length
                  const allSelected = availableRows.length > 0
                    && selectedCount === availableRows.length

                  return (
                    <TableCell
                      key={`select-draw-${drawIndex}`}
                      align="center"
                      sx={{ borderLeft: 1, borderColor: 'divider' }}
                    >
                      <Stack
                        direction="row"
                        spacing={0.25}
                        sx={{ alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Checkbox
                          size="small"
                          checked={allSelected}
                          indeterminate={selectedCount > 0 && !allSelected}
                          disabled={availableRows.length === 0}
                          onChange={() => toggleDrawSelections(drawIndex)}
                          inputProps={{
                            'aria-label': `Select available cells for Draw ${drawIndex + 1}`,
                          }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {selectedCount}/{availableRows.length}
                        </Typography>
                      </Stack>
                    </TableCell>
                  )
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {worksheet.rows.map((row) => {
                const availableDrawIndexes = worksheet.draws
                  .map((_, drawIndex) => drawIndex)
                  .filter((drawIndex) => !selectionIsUsed(row.id, drawIndex)
                    && !cellDisabled(row, drawIndex))
                const groupSelectable = rowAllowsGroupSelection(row)
                const selectedCount = availableDrawIndexes.filter(
                  (drawIndex) => selectionIsSelected(row.id, drawIndex),
                ).length
                const allSelected = availableDrawIndexes.length > 0
                  && selectedCount === availableDrawIndexes.length

                return (
                  <TableRow key={row.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
                        {groupSelectable && (
                          <Checkbox
                            size="small"
                            checked={allSelected}
                            indeterminate={selectedCount > 0 && !allSelected}
                            disabled={availableDrawIndexes.length === 0}
                            onChange={() => toggleLotSelections(row.id)}
                            inputProps={{
                              'aria-label': `Select available Draws for lot ${row.lotNumber}`,
                            }}
                          />
                        )}
                        <Typography color="error.main" fontWeight={850}>
                          {row.utilityLabel ?? row.lotNumber}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight={750}>{row.planCode ?? '—'}</Typography>
                      {(row.selectedOptions?.length ?? 0) > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          {row.selectedOptions.length}{' '}
                          {row.selectedOptions.length === 1 ? 'option' : 'options'}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight={750}>
                        {formatCurrency(row.drawBasePrice)}
                      </Typography>
                    </TableCell>
                    {worksheet.draws.map((_, drawIndex) => {
                      const key = drawSelectionKey(
                        job?.id,
                        phase?.id,
                        row.id,
                        drawIndex,
                      )
                      const owner = usedSelections.get(key)
                      const selected = selectionIsSelected(row.id, drawIndex)
                      const calendarKey = calendarSelectionKey(
                        phase?.id,
                        row.id,
                        drawIndex,
                      )
                      const calendarSuggested = suggestedSelectionKeys.has(calendarKey)
                      const calendarReady = calendarReadySelectionKeys.has(calendarKey)
                      const disabled = !owner && cellDisabled(row, drawIndex)

                      return (
                        <TableCell
                          key={key}
                          align="center"
                          title={calendarSuggested
                            ? 'Suggested from Calendar'
                            : calendarReady
                              ? 'Calendar work is ready; available for manual selection'
                              : undefined}
                          onClick={() => !owner && !disabled && toggleSelection(row.id, drawIndex)}
                          sx={{
                            borderLeft: 1,
                            borderColor: selected
                              ? calendarSuggested ? 'success.main' : 'primary.main'
                              : 'divider',
                            bgcolor: owner
                              ? 'warning.light'
                              : calendarSuggested
                                ? 'success.light'
                                : calendarReady
                                  ? 'info.light'
                                  : selected
                                    ? 'primary.light'
                                    : undefined,
                            cursor: owner || disabled ? 'default' : 'pointer',
                            opacity: disabled ? 0.5 : 1,
                          }}
                        >
                          {owner ? (
                            <Box>
                              <Stack
                                direction="row"
                                spacing={0.5}
                                sx={{ alignItems: 'center', justifyContent: 'center' }}
                              >
                                <LockRoundedIcon sx={{ fontSize: 14 }} />
                                <Typography variant="caption" fontWeight={850}>
                                  {owner.packageNumber}
                                </Typography>
                              </Stack>
                              <Typography variant="caption" component="div">
                                {formatCurrency(row.drawAmounts[drawIndex])}
                              </Typography>
                            </Box>
                          ) : (
                            <Stack
                              direction="row"
                              spacing={0.25}
                              sx={{ alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Checkbox
                                size="small"
                                checked={selected}
                                disabled={disabled}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => toggleSelection(row.id, drawIndex)}
                                inputProps={{
                                  'aria-label': `Select lot ${row.lotNumber}, Draw ${drawIndex + 1}`,
                                }}
                              />
                              <Typography variant="body2" fontWeight={850}>
                                {formatCurrency(row.drawAmounts[drawIndex])}
                              </Typography>
                            </Stack>
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })}
            </TableBody>
            {worksheet.rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>
                    <Typography fontWeight={850}>
                      {selectedLotKeys.length}{' '}
                      {selectedLotKeys.length === 1 ? 'lot' : 'lots'} ·{' '}
                      {selectedSelections.length}{' '}
                      {selectedSelections.length === 1 ? 'cell' : 'cells'}
                    </Typography>
                  </TableCell>
                  {worksheet.draws.map((_, drawIndex) => (
                    <TableCell
                      key={`selected-total-${drawIndex}`}
                      align="center"
                      sx={{ borderLeft: 1, borderColor: 'divider' }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {selectedSelections.filter(
                          (selection) => (
                            String(selection.phaseId) === String(phase.id)
                            && selection.drawIndex === drawIndex
                          ),
                        ).length}{' '}
                        selected
                      </Typography>
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </TableContainer>
      </Card>
    </Box>
  )
}
