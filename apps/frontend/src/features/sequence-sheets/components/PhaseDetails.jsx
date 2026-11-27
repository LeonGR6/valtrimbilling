import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import {
  CatalogPageHeader,
  FigureStrip,
  RowActionsMenu,
  catalogTableSx,
} from '../../../components/common/CatalogPage'
import PhaseCalendarChip from '../../calendar/components/PhaseCalendarChip.jsx'
import JobModuleNavigation from '../../jobs/components/JobModuleNavigation.jsx'
import { builderJobsPath, jobPlansOptionsPath, jobSequenceSheetPath } from '../../jobs/utils/jobRoutes.js'
import { formatBuilding, formatPhase } from '../utils/phaseBuildingCodes.js'
import PriorChangeOrderNotice from '../../change-orders/components/PriorChangeOrderNotice.jsx'
import { getPhaseRowCounts, getSelectedOptionCount } from '../utils/phaseCounts.js'
import { describeOptionDetail, detailOf } from '../utils/optionDetails.js'
import OptionOrderChip from '../../purchase-orders/components/OptionOrderChip.jsx'
import OptionsBillingNotice from '../../jobs/components/OptionsBillingNotice.jsx'
import { usePurchaseOrderOptionLinks } from '../../purchase-orders/hooks/usePurchaseOrders.js'
import { countOptionsWithOrder } from '../../purchase-orders/services/purchaseOrderRecord.js'
import { getPlan } from '../utils/sequenceSheetPlans.js'

export default function PhaseDetails({
  builderId,
  calendarStatus,
  canManage,
  canSchedule,
  job,
  phase,
  onDelete,
  onEdit,
  onEmail,
  onSchedule,
}) {
  const phaseLabel = formatPhase(phase.name)
  const buildingLabel = formatBuilding(phase.building)
  const selectedOptionCount = getSelectedOptionCount(phase)
  const rowCounts = getPhaseRowCounts(phase)
  // The Purchase Orders behind each option; nothing shows while they load or if they fail.
  const orders = usePurchaseOrderOptionLinks(job.id)
  const optionsOf = (lot) => (lot.isUtilityBuilding
    ? []
    : (getPlan(job, lot.planId)?.options ?? []).filter((option) => lot.optionIds?.includes(option.id)))
  const optionsWithOrder = orders.index
    ? countOptionsWithOrder(orders.index, (phase.lots ?? []).filter((lot) => !lot.isUtilityBuilding), optionsOf)
    : 0

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader
        borderless
        breadcrumbs={[
          { label: 'Jobs', to: '/jobs' },
          { label: job.builder, to: builderJobsPath(builderId) },
          { label: `Job ${job.code}`, to: jobPlansOptionsPath(builderId, job.id) },
          { label: 'Sequence sheet', to: jobSequenceSheetPath(builderId, job.id) },
          { label: phaseLabel },
        ]}
        title={phaseLabel}
        titleAdornment={<PhaseCalendarChip status={calendarStatus} size="medium" />}
        subtitle={[buildingLabel, job.community, job.builder].filter(Boolean).join(' · ')}
        meta={(
          <FigureStrip
            label={`${phaseLabel} summary`}
            figures={[
              { label: rowCounts.lots === 1 ? 'lot' : 'lots', value: rowCounts.lots },
              ...(rowCounts.utility > 0
                ? [{
                  label: rowCounts.utility === 1 ? 'utility row' : 'utility rows',
                  value: rowCounts.utility,
                }]
                : []),
              {
                label: selectedOptionCount === 1 ? 'selected option' : 'selected options',
                value: selectedOptionCount,
              },
              ...(optionsWithOrder > 0
                ? [{
                  label: optionsWithOrder === 1 ? 'with a purchase order' : 'with purchase orders',
                  value: optionsWithOrder,
                }]
                : []),
            ]}
          />
        )}
        actions={canManage && (
          <>
            <Button
              variant="contained"
              startIcon={<EmailRoundedIcon />}
              onClick={onEmail}
              disableElevation
            >
              Email sequence sheet
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<EditOutlinedIcon />}
              onClick={onEdit}
            >
              Edit phase
            </Button>
            <RowActionsMenu
              label={`More actions for ${phaseLabel}`}
              items={[
                {
                  label: 'Delete phase',
                  icon: <DeleteOutlineRoundedIcon fontSize="small" />,
                  color: 'error.main',
                  onClick: onDelete,
                },
              ]}
            />
          </>
        )}
      />

      <JobModuleNavigation
        active="sequence-sheet"
        builderId={builderId}
        jobId={job.id}
        showBack={false}
      />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {calendarStatus === 'unscheduled' && (
          <Alert
            severity="warning"
            sx={{ mb: 2.5 }}
            action={canSchedule ? (
              <Button color="inherit" size="small" onClick={onSchedule}>
                Schedule in Calendar
              </Button>
            ) : undefined}
          >
            This Phase has no EXT, DM or HW events in the Calendar yet. Package
            Suggestions only appear for Phases with Calendar work.
          </Alert>
        )}
        {orders.openError && (
          <Alert severity="error" sx={{ mb: 2.5 }}>{orders.openError}</Alert>
        )}
        <OptionsBillingNotice job={job} optionCount={selectedOptionCount} sx={{ mb: 2.5 }} />
        <PriorChangeOrderNotice
          jobId={job.id}
          lotNumbers={(phase.lots ?? []).filter((lot) => !lot.isUtilityBuilding).map((lot) => lot.lotNumber)}
          sx={{ mb: 2.5 }}
        />

        <Box
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Box sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <Typography component="h2" variant="subtitle1" fontWeight={700}>
              Phase assignments
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Lots and Utility rows keep their orientation. Utility rows use only one Plan Price.
              {optionsWithOrder > 0 && ' Options marked with a receipt have a Purchase Order: click one to see it.'}
            </Typography>
          </Box>
          <TableContainer>
            <Table
              size="small"
              aria-label={`${phaseLabel} lot and Utility assignments`}
              sx={[{ minWidth: 700 }, catalogTableSx]}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Lot / Utility</TableCell>
                  <TableCell>Plan</TableCell>
                  <TableCell sx={{ width: 100 }}>Elevation</TableCell>
                  <TableCell align="center">Reverse</TableCell>
                  <TableCell>Options for selected plan</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(phase.lots ?? []).map((lot) => {
                  const plan = getPlan(job, lot.planId)
                  const options = (plan?.options ?? []).filter((option) =>
                    lot.optionIds?.includes(option.id),
                  )

                  return (
                    <TableRow key={lot.id} hover>
                      <TableCell sx={{ width: 110 }}>
                        <Typography variant="body2" fontWeight={700}>
                          {lot.isUtilityBuilding
                            ? lot.utilityName
                            : lot.lotNumber}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ minWidth: 160 }}>
                        {plan ? (
                          <Typography variant="body2">{plan.code}</Typography>
                        ) : (
                          <Typography variant="body2" color="error">Plan unavailable</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ width: 100 }}>
                        {lot.elevation && !lot.isUtilityBuilding ? (
                          <Typography variant="body2" fontWeight={700}>{lot.elevation}</Typography>
                        ) : (
                          <Typography variant="body2" color="text.disabled">—</Typography>
                        )}
                      </TableCell>
                      <TableCell align="center" sx={{ width: 100 }}>
                        {lot.reverse ? (
                          <Chip size="small" color="primary" label="Reverse" />
                        ) : (
                          <Typography variant="body2" color="text.disabled">No</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ minWidth: 320 }}>
                        {lot.isUtilityBuilding ? (
                          <Typography variant="body2" color="text.secondary">Plan only</Typography>
                        ) : options.length > 0 ? (
                          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                            {options.map((option) => {
                              const detailText = describeOptionDetail(detailOf(lot.optionDetails, option.id))
                              return (
                                <Box key={option.id} sx={{ maxWidth: '100%' }}>
                                  <OptionOrderChip
                                    option={option}
                                    lot={lot}
                                    lines={orders.index?.linesFor({
                                      lotId: lot.id,
                                      optionId: option.id,
                                      optionCode: option.code,
                                    }) ?? []}
                                    files={orders.files}
                                    openingId={orders.openingId}
                                    onOpenFile={orders.openFile}
                                  />
                                  {detailText && (
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                      sx={{ display: 'block', mt: 0.25, ml: 0.5, overflowWrap: 'anywhere' }}
                                    >
                                      {detailText}
                                    </Typography>
                                  )}
                                </Box>
                              )
                            })}
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="text.disabled">
                            No options selected
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Box>
    </Box>
  )
}
