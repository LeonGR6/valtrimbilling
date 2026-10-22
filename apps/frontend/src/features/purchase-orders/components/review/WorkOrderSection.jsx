import { useMemo } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Collapse,
  Stack,
  Typography,
} from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import {
  COMPARISON_STATUSES,
  HEADER_STATUSES,
  describeHeaderMatch,
  linesWithStatus,
  summarizeComparison,
} from '../../services/purchaseOrderRecord.js'
import ComparisonLineRow, { ComparisonColumnHeads } from './ComparisonLineRow.jsx'

/**
 * One work order (one Lot of the PDF) and its options. A work order whose options all match
 * starts closed with a one-line verdict, so what needs a look is what is on screen.
 */
export default function WorkOrderSection({
  group,
  open,
  onToggle,
  statusFilter,
  canManage,
  confirming,
  onConfirm,
  onImportLine,
  onUsePrice,
}) {
  const summary = summarizeComparison(group.lines)
  const header = HEADER_STATUSES[group.headerStatus]
  const note = describeHeaderMatch(group)
  const lines = useMemo(
    () => linesWithStatus(group.lines, statusFilter).sort((a, b) =>
      COMPARISON_STATUSES[b.status].severity - COMPARISON_STATUSES[a.status].severity
      || a.optionCode.localeCompare(b.optionCode)),
    [group.lines, statusFilter],
  )
  const printed = [
    group.printed.lot ? `Lot ${group.printed.lot}` : null,
    group.printed.phase ? `Phase ${group.printed.phase}` : null,
    group.printed.plan ? `Plan ${group.printed.plan}` : null,
  ].filter(Boolean).join(' · ')
  const title = group.system ? `Lot ${group.system.lotNumber}` : printed || 'Work order'
  const bodyId = `work-order-${group.key.replace(/[^A-Za-z0-9_-]/gu, '-')}`

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ alignItems: { xs: 'stretch', sm: 'center' }, bgcolor: 'action.hover' }}
      >
        <ButtonBase
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          sx={{
            flex: 1,
            minWidth: 0,
            px: 1.5,
            py: 1.25,
            gap: 1,
            justifyContent: 'flex-start',
            textAlign: 'left',
            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
          }}
        >
          <ChevronRightRoundedIcon
            fontSize="small"
            sx={{
              color: 'text.secondary',
              flexShrink: 0,
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform 150ms',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography fontWeight={850}>
              {title}
              {group.system && (
                <Typography component="span" color="text.secondary" fontWeight={500}>
                  {' · '}Phase {group.system.phaseCode} · Plan {group.system.planCode}
                </Typography>
              )}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              Work order {group.workOrderNo}
              {group.system && printed ? ` · The PDF says ${printed}` : ''}
            </Typography>
          </Box>
        </ButtonBase>

        <Stack
          direction="row"
          spacing={0.75}
          sx={{
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: { xs: 'flex-start', sm: 'flex-end' },
            pl: { xs: 5, sm: 0 },
            pr: 1.5,
            pb: { xs: 1.25, sm: 0 },
            pt: { xs: 0, sm: 0.5 },
          }}
          useFlexGap
        >
          {header && group.headerStatus !== 'resolved' && (
            <Chip size="small" color={header.color} label={header.label} />
          )}
          <Chip
            size="small"
            variant="outlined"
            color={summary.attention > 0 ? 'warning' : 'success'}
            label={summary.attention > 0
              ? `${summary.attention} of ${summary.total} to review`
              : `${summary.total === 1 ? 'Matches' : `All ${summary.total} match`}`}
          />
          {group.headerStatus === 'suggested' && canManage && (
            <Button
              size="small"
              variant="contained"
              disableElevation
              startIcon={confirming ? <CircularProgress size={14} color="inherit" /> : <TaskAltRoundedIcon />}
              disabled={confirming}
              onClick={() => onConfirm(group)}
              sx={{ textTransform: 'none' }}
            >
              Confirm match
            </Button>
          )}
        </Stack>
      </Stack>

      <Collapse in={open} unmountOnExit>
        <Box id={bodyId}>
          {note && (
            <Alert
              severity={group.headerStatus === 'suggested' ? 'info' : 'warning'}
              sx={{ borderRadius: 0 }}
            >
              {note}
            </Alert>
          )}
          <ComparisonColumnHeads />
          {lines.map((line) => (
            <ComparisonLineRow
              key={line.lineId}
              line={line}
              onImportLine={onImportLine}
              onUsePrice={onUsePrice}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}
