import {
  Box,
  Button,
  Link,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'
import {
  RowActionsMenu,
  catalogTableSx,
  focusRingSx,
  visuallyHiddenSx,
} from '../../../components/common/CatalogPage'
import PhaseCalendarChip from '../../calendar/components/PhaseCalendarChip.jsx'
import { formatBuilding, formatPhase } from '../utils/phaseBuildingCodes.js'
import { getPhaseRowCounts, getSelectedOptionCount } from '../utils/phaseCounts.js'

/**
 * The Phases of one Job as a table: the Phase and its building, whether it is on
 * the Calendar, how many lots and options it carries, and its actions. Opening
 * the Phase is the visible action; email, edit and delete wait in the row menu.
 */
export default function PhasesTable({
  job,
  phases,
  canManage,
  calendarCoverage,
  onOpen,
  onEmail,
  onEdit,
  onDelete,
}) {
  return (
    <TableContainer>
      <Table
        size="small"
        aria-label={`Phases of Job ${job.code}`}
        sx={[{ minWidth: 760 }, catalogTableSx]}
      >
        <TableHead>
          <TableRow>
            <TableCell>Phase</TableCell>
            <TableCell>Calendar</TableCell>
            <TableCell align="right">Lots</TableCell>
            <TableCell align="right">Utility rows</TableCell>
            <TableCell align="right">Selected options</TableCell>
            <TableCell>Created</TableCell>
            <TableCell align="right" width={canManage ? 130 : 100}>
              <Box component="span" sx={visuallyHiddenSx}>Actions</Box>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {phases.map((phase) => {
            const phaseLabel = formatPhase(phase.name)
            const rowCounts = getPhaseRowCounts(phase)
            const selectedOptionCount = getSelectedOptionCount(phase)
            const calendarStatus = calendarCoverage.ready
              ? calendarCoverage.statusOf(job, phase)
              : null

            return (
              <TableRow
                key={phase.id}
                hover
                onClick={() => onOpen(phase)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  <Link
                    component="button"
                    type="button"
                    underline="hover"
                    variant="body2"
                    fontWeight={700}
                    aria-label={`View details for ${phaseLabel}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpen(phase)
                    }}
                    sx={[{ textAlign: 'left' }, focusRingSx]}
                  >
                    {phaseLabel}
                  </Link>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {formatBuilding(phase.building)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <PhaseCalendarChip status={calendarStatus} />
                </TableCell>
                <TableCell align="right">{rowCounts.lots}</TableCell>
                <TableCell align="right">
                  <Typography
                    variant="body2"
                    color={rowCounts.utility ? 'text.primary' : 'text.disabled'}
                  >
                    {rowCounts.utility}
                  </Typography>
                </TableCell>
                <TableCell align="right">{selectedOptionCount}</TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {phase.createdAt}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                    <Button
                      size="small"
                      color="inherit"
                      endIcon={<ArrowForwardRoundedIcon />}
                      aria-label={`Open ${phaseLabel}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpen(phase)
                      }}
                      sx={{ color: 'primary.main' }}
                    >
                      Open
                    </Button>
                    {canManage && (
                      <RowActionsMenu
                        label={`Actions for ${phaseLabel}`}
                        items={[
                          {
                            label: 'Email sequence sheet',
                            icon: <EmailRoundedIcon fontSize="small" />,
                            onClick: () => onEmail(phase),
                          },
                          {
                            label: 'Edit phase',
                            icon: <EditOutlinedIcon fontSize="small" />,
                            onClick: () => onEdit(phase),
                          },
                          {
                            label: 'Delete phase',
                            icon: <DeleteOutlineRoundedIcon fontSize="small" />,
                            color: 'error.main',
                            onClick: () => onDelete(phase),
                          },
                        ]}
                      />
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
