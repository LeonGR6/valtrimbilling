import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import {
  describeIssue,
  describeTotals,
  drawLabel,
  formatMoney,
  LAYOUTS,
  lotRows,
  normalizeCodeKey,
  printedPhases,
  summarizeCells,
  visibleIssues,
} from '../services/paymentScheduleRecord.js'

function Section({ title, children }) {
  return (
    <Stack spacing={1}>
      <Typography variant="overline" color="text.secondary" fontWeight={800}>
        {title}
      </Typography>
      {children}
    </Stack>
  )
}

function SelectedCell({ cell, template, removed, readOnly, onToggleRemoved }) {
  return (
    <Box sx={{ p: 1.5, border: 1, borderColor: 'primary.main', borderRadius: 1.5 }}>
      <Typography fontWeight={800}>
        Lot {cell.lot}{cell.phase ? ` · Phase ${cell.phase}` : ''}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {drawLabel(cell.draw, template)} · page {cell.page}
      </Typography>
      <Typography variant="h6" fontWeight={850} sx={{ mt: 0.5 }}>
        {formatMoney(cell.amount)}
      </Typography>
      {!readOnly && (
        <Button
          size="small"
          color={removed ? 'primary' : 'error'}
          startIcon={removed ? <RestoreRoundedIcon /> : <DeleteOutlineRoundedIcon />}
          onClick={() => onToggleRemoved(cell.key)}
          sx={{ mt: 0.5 }}
        >
          {removed ? 'Restore this amount' : 'Remove this amount'}
        </Button>
      )}
    </Box>
  )
}

export default function PaymentScheduleSummaryPanel({
  template,
  cells,
  removedKeys,
  activeCells,
  selectedKey,
  selectedLotId,
  phaseMap,
  jobPhases,
  unmatchedPhases,
  summaryRows,
  fillSummary,
  acknowledged,
  validation,
  readOnly,
  onSelectCell,
  onSelectLot,
  onToggleRemoved,
  onFillSummaryChange,
  onSearchSummary,
  onRestoreAll,
  onPhaseChange,
  onAcknowledgeChange,
}) {
  const layout = LAYOUTS[template.layout]
  const summary = summarizeCells(activeCells)
  // Against what is left after the reviewer's removals, not what was detected.
  const totals = describeTotals({
    expectedTotal: template.expectedTotal,
    foundTotal: summary.total,
  })
  const { shown, hidden } = visibleIssues(template.issues)
  const rows = lotRows(cells)
  const drawNumbers = [...new Set(cells.map((cell) => cell.draw))].sort((a, b) => a - b)
  const selectedCell = cells.find((cell) => cell.key === selectedKey) ?? null
  const printed = printedPhases(cells)

  return (
    <Stack spacing={2.5}>
      <Section title="What was found">
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" color="primary" label={`${layout?.label ?? 'Unknown'} layout`} />
          <Chip size="small" variant="outlined" label={`${summary.cellCount} amounts`} />
          <Chip size="small" variant="outlined" label={`${summary.lotCount} Lots`} />
          <Chip size="small" variant="outlined" label={`${summary.draws.length} draws`} />
        </Stack>
        {layout && (
          <Typography variant="caption" color="text.secondary">{layout.description}</Typography>
        )}
        <Alert severity={totals.color} sx={{ py: 0 }}>{totals.text}</Alert>
      </Section>

      {template.issues.length > 0 && (
        <Section title="Check these">
          <Stack spacing={0.75}>
            {shown.map((issue, index) => (
              // Issues have no id; the list is fixed for a given analysis.
              <Alert key={`${issue.code}-${index}`} severity="warning" sx={{ py: 0 }}>
                {describeIssue(issue)}
              </Alert>
            ))}
            {hidden > 0 && (
              <Typography variant="caption" color="text.secondary">
                and {hidden} more.
              </Typography>
            )}
          </Stack>
        </Section>
      )}

      <Section title="Draws">
        <Table size="small" aria-label="Amounts per draw">
          <TableHead>
            <TableRow>
              <TableCell>Draw</TableCell>
              <TableCell align="right">Amounts</TableCell>
              <TableCell align="right">Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {summary.draws.map((entry) => (
              <TableRow key={entry.draw}>
                <TableCell>{drawLabel(entry.draw, template)}</TableCell>
                <TableCell align="right">{entry.count}</TableCell>
                <TableCell align="right">{formatMoney(entry.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      {template.layout === 'matrix' && (
        <Section title="Previously Invoiced and This Request">
          {summaryRows ? (
            <>
              <Typography variant="caption" color="text.secondary">
                This schedule has a blank "Previously Invoiced" and "This Request" row
                for each draw (the blue boxes on the PDF). A Package can write what was
                billed before and what it bills now.
              </Typography>
              <FormControlLabel
                disabled={readOnly}
                control={(
                  <Checkbox
                    checked={fillSummary}
                    onChange={(event) => onFillSummaryChange(event.target.checked)}
                  />
                )}
                label="Fill them for each Package"
              />
            </>
          ) : (
            <>
              <Typography variant="caption" color="text.secondary">
                These two rows were not found in this schedule. If it was analyzed before
                they could be read, look for them again.
              </Typography>
              {!readOnly && (
                <Button size="small" onClick={onSearchSummary} sx={{ alignSelf: 'flex-start' }}>
                  Look for them again
                </Button>
              )}
            </>
          )}
        </Section>
      )}

      <Section title="Phases">
        <Typography variant="caption" color="text.secondary">
          Choose the Phase of this Job that each Phase in the PDF stands for. Packages
          find the amounts through it.
        </Typography>
        {printed.map((phase) => {
          const chosen = phaseMap[phase] ?? ''
          const suggested = chosen !== '' && normalizeCodeKey(chosen) !== normalizeCodeKey(phase)
          return (
            <TextField
              key={phase || 'none'}
              select
              size="small"
              label={phase === '' ? 'No Phase printed' : `Printed as “${phase}”`}
              value={chosen}
              disabled={readOnly}
              onChange={(event) => onPhaseChange(phase, event.target.value)}
              helperText={phase === '' && chosen === ''
                ? 'The document prints no Phase. Leave this empty to match Lots of any Phase.'
                : suggested ? 'Suggested from the printed code. Check it.' : undefined}
            >
              <MenuItem value="">
                {phase === '' ? 'Any Phase' : 'Keep as printed'}
              </MenuItem>
              {jobPhases.map((jobPhase) => (
                <MenuItem key={jobPhase.code} value={jobPhase.code}>
                  {jobPhase.code}{jobPhase.building ? ` · ${jobPhase.building}` : ''}
                </MenuItem>
              ))}
            </TextField>
          )
        })}
        {unmatchedPhases.length > 0 && (
          <Alert severity="warning" sx={{ py: 0 }}>
            This Job has no Phase {unmatchedPhases.join(', ')}, so a Package will not
            find those amounts. Choose the matching Phase above.
          </Alert>
        )}
      </Section>

      {selectedCell && (
        <Section title="Selected amount">
          <SelectedCell
            cell={selectedCell}
            template={template}
            removed={removedKeys.has(selectedCell.key)}
            readOnly={readOnly}
            onToggleRemoved={onToggleRemoved}
          />
        </Section>
      )}

      <Section title="Detected amounts">
        <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
          <Table
            size="small"
            aria-label="Detected amounts by Lot and draw"
            sx={{ minWidth: 340, '& th, & td': { px: 0.75, fontSize: 11.5 } }}
          >
            <TableHead>
              <TableRow>
                <TableCell>Lot</TableCell>
                {drawNumbers.map((draw) => (
                  <TableCell key={draw} align="right">D{draw}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  selected={row.id === selectedLotId}
                  onClick={() => onSelectLot(row.id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell sx={{ fontWeight: 750, whiteSpace: 'nowrap' }}>
                    {row.lot}{row.phase ? ` · ${row.phase}` : ''}
                  </TableCell>
                  {drawNumbers.map((draw) => {
                    const cell = row.byDraw[draw]
                    const removed = cell && removedKeys.has(cell.key)
                    return (
                      <TableCell
                        key={draw}
                        align="right"
                        onClick={(event) => {
                          if (!cell) return
                          event.stopPropagation()
                          onSelectCell(cell.key)
                        }}
                        sx={{
                          whiteSpace: 'nowrap',
                          textDecoration: removed ? 'line-through' : 'none',
                          color: removed ? 'text.disabled' : 'text.primary',
                          bgcolor: cell?.key === selectedKey ? 'action.selected' : 'transparent',
                        }}
                      >
                        {cell ? formatMoney(cell.amount).replace('$', '') : '—'}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        {removedKeys.size > 0 && !readOnly && (
          <Button size="small" startIcon={<RestoreRoundedIcon />} onClick={onRestoreAll}>
            Restore {removedKeys.size} removed {removedKeys.size === 1 ? 'amount' : 'amounts'}
          </Button>
        )}
      </Section>

      {!validation.success && (
        <Alert severity="error">
          <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
            {validation.errors.map((message) => <li key={message}>{message}</li>)}
          </Stack>
        </Alert>
      )}

      {template.issues.length > 0 && !readOnly && (
        <>
          <Divider />
          <FormControlLabel
            control={(
              <Checkbox
                checked={acknowledged}
                onChange={(event) => onAcknowledgeChange(event.target.checked)}
              />
            )}
            label="I checked the highlighted amounts against the PDF"
          />
        </>
      )}
    </Stack>
  )
}
