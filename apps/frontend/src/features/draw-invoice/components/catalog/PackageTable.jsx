import { useState } from 'react'
import {
  Box,
  Button,
  ButtonGroup,
  Card,
  CircularProgress,
  ListItemIcon,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
  Chip,
} from '@mui/material'
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import MoveToInboxRoundedIcon from '@mui/icons-material/MoveToInboxRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import {
  formatBuilding,
  formatPhase,
} from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import { canCorrectDrawPackage } from '../../services/drawInvoicePackageRecord.js'
import { describeJobDocumentProgress } from '../../services/jobDocumentRecord.js'
import { formatPackageScopeEventTypes } from '../../utils/drawPackages.js'
import {
  formatBillingPeriod,
  formatCurrency,
  formatLongDate,
} from '../../utils/drawInvoiceFormatters.js'
import { canDeleteDraftPackage } from '../../utils/packageCatalog.js'
import { PACKAGE_SORT_COLUMNS } from '../../utils/packageCatalog.js'
import { isMultiPhasePackage } from '../../utils/packagePhaseScope.js'
import { quickbooksTableStatusView } from '../../services/quickbooksRecord.js'
import { PackageStatusChip } from '../shared/PackageUi.jsx'

const packageTableColumns = [
  { key: 'package', width: 240 },
  { key: 'status', width: 140 },
  { key: 'builder', width: 170 },
  { key: 'billing-period', width: 130 },
  { key: 'lots', width: 105 },
  { key: 'current-draw', width: 135 },
  { key: 'retention-wrap', width: 180 },
  { key: 'invoice-amount', width: 140 },
  { key: 'documents', width: 125 },
  { key: 'quickbooks', width: 150 },
  { key: 'action', width: 120 },
]

// A thin bar on the row's left edge, so the status reads at a glance.
const statusAccentPalettes = {
  DRAFT: 'warning',
  AWAITING_PAYMENT: 'info',
  PAID_CLOSED: 'success',
}

const quickbooksToneColors = {
  success: 'success.main',
  warning: 'warning.main',
  neutral: 'text.secondary',
}

const packageTableMinimumWidth = packageTableColumns.reduce(
  (total, column) => total + column.width,
  0,
)

function PackageActionMenu({ context, canManage, onOpen, onAction }) {
  const [anchorEl, setAnchorEl] = useState(null)
  const { record } = context
  const editable = canManage && canCorrectDrawPackage(record)
  const deletable = canManage && canDeleteDraftPackage(record)
  const close = () => setAnchorEl(null)
  const choose = (action) => {
    close()
    if (action === 'open') onOpen(context)
    else onAction(action, context)
  }

  return (
    <>
      <ButtonGroup size="small" variant="outlined" color="inherit">
        <Button onClick={() => onOpen(context)}>Open</Button>
        <Button
          aria-label={`More actions for ${record.packageNumber}`}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchorEl)}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{ minWidth: 32, px: 0.5 }}
        >
          <ArrowDropDownRoundedIcon />
        </Button>
      </ButtonGroup>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={close}>
        <MenuItem onClick={() => choose('open')}>Open Package</MenuItem>
        {editable && (
          <MenuItem onClick={() => choose('edit')}>
            <ListItemIcon><EditRoundedIcon fontSize="small" /></ListItemIcon>
            Edit Package
          </MenuItem>
        )}
        {editable && (
          <MenuItem onClick={() => choose('transfer')}>
            <ListItemIcon><MoveToInboxRoundedIcon fontSize="small" /></ListItemIcon>
            Move cells here
          </MenuItem>
        )}
        {deletable && (
          <MenuItem onClick={() => choose('delete')} sx={{ color: 'error.main' }}>
            <ListItemIcon><DeleteOutlineRoundedIcon fontSize="small" color="error" /></ListItemIcon>
            Delete draft
          </MenuItem>
        )}
      </Menu>
    </>
  )
}

function PackageDocumentProgress({ job, documentState }) {
  const {
    documentsByJob = {},
    requiredTypeKeysByJob = {},
    initialized = false,
    loading = false,
  } = documentState ?? {}

  if (!initialized) {
    return (
      <Box sx={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>
        {loading ? (
          <CircularProgress size={18} aria-label="Loading document status" />
        ) : (
          <Typography variant="body2" color="text.secondary">Unavailable</Typography>
        )}
      </Box>
    )
  }

  const jobKey = String(job.id)
  const progress = describeJobDocumentProgress(
    requiredTypeKeysByJob[jobKey] ?? [],
    documentsByJob[jobKey] ?? [],
  )
  const statusColor = {
    complete: 'success.main',
    missing: 'warning.main',
    'not-required': 'text.secondary',
  }[progress.status]

  return (
    <Box aria-label={`Documents ${progress.countLabel}, ${progress.statusLabel}`}>
      <Typography fontWeight={850}>{progress.countLabel}</Typography>
      <Typography
        variant="body2"
        fontWeight={750}
        sx={{ color: statusColor }}
      >
        {progress.statusLabel}
      </Typography>
    </Box>
  )
}

function PackageQuickbooksStatus({ record }) {
  const view = quickbooksTableStatusView(record)

  if (!view) return <Typography variant="body2" color="text.secondary">—</Typography>

  return (
    <Box aria-label={`QuickBooks ${view.status}`}>
      <Typography fontWeight={750} sx={{ color: quickbooksToneColors[view.tone] }}>
        {view.status}
      </Typography>
      {view.detail && (
        <Typography variant="body2" color="text.secondary">{view.detail}</Typography>
      )}
    </Box>
  )
}

function SortableHeader({ column, label, sort, onSort }) {
  const active = sort?.key === column
  const direction = active ? sort.direction : PACKAGE_SORT_COLUMNS[column].firstDirection

  return (
    <TableCell sortDirection={active ? direction : false}>
      <TableSortLabel
        active={active}
        direction={direction}
        onClick={() => onSort(column)}
        title={`Sort by ${PACKAGE_SORT_COLUMNS[column].label}`}
        sx={{
          color: 'inherit !important',
          // Show the arrow faintly on every sortable column so it reads as clickable.
          '& .MuiTableSortLabel-icon': {
            color: 'inherit !important',
            opacity: active ? 1 : 0.4,
          },
        }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  )
}

export default function PackageTable({
  filteredContexts,
  activeContexts,
  documentState,
  canManage,
  sort = null,
  onSort = () => {},
  onOpen,
  onAction,
  onClearFilters,
}) {
  return (
    <>
      <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer>
          <Table
            sx={{
              minWidth: packageTableMinimumWidth,
              tableLayout: 'fixed',
              '& .MuiTableCell-root': { px: 1.5, py: 1.1, verticalAlign: 'top' },
              '& .MuiTableCell-head': { py: 0.9 },
              '& tbody tr:last-of-type .MuiTableCell-root': { borderBottom: 0 },
            }}
          >
            <colgroup>
              {packageTableColumns.map((column) => (
                <col key={column.key} style={{ width: column.width }} />
              ))}
            </colgroup>
            <TableHead>
              <TableRow
                sx={{
                  bgcolor: 'sidebar.bg',
                  '& .MuiTableCell-root': {
                    color: 'text.secondary',
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  },
                }}
              >
                <SortableHeader column="created" label="Package" sort={sort} onSort={onSort} />
                <TableCell>Status</TableCell>
                <SortableHeader column="builder" label="Builder/Community" sort={sort} onSort={onSort} />
                <SortableHeader column="period" label="Billing Period" sort={sort} onSort={onSort} />
                <TableCell>Lots/Scopes</TableCell>
                <TableCell>Current Draw</TableCell>
                <TableCell>Retention / WRAP Insurance</TableCell>
                <SortableHeader column="invoice" label="Invoice Amount" sort={sort} onSort={onSort} />
                <TableCell>Documents</TableCell>
                <TableCell>QuickBooks</TableCell>
                <TableCell>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredContexts.map(({ record, job, phase, phases, summary }) => (
                <TableRow
                  key={record.id}
                  hover
                  onClick={() => onOpen(record, job, phase)}
                  sx={{
                    cursor: 'pointer',
                    '& > td:first-of-type': {
                      boxShadow: (theme) => `inset 3px 0 0 ${
                        theme.palette[statusAccentPalettes[record.status]]?.main ?? 'transparent'
                      }`,
                    },
                  }}
                >
                  <TableCell>
                    <Button
                      color="inherit"
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpen(record, job, phase)
                      }}
                      sx={{
                        p: 0,
                        minWidth: 0,
                        fontWeight: 800,
                        fontSize: '0.95rem',
                        textTransform: 'none',
                        justifyContent: 'flex-start',
                      }}
                    >
                      {record.packageNumber}
                    </Button>
                    <Typography variant="body2" color="text.secondary">
                      Job #{job.code} · {record.packageType === 'RETENTION_RELEASE'
                        ? record.retentionRelease?.scopeType === 'JOB'
                          ? 'Per Job'
                          : `${formatPhase(record.retentionRelease?.phaseCode)} / ${formatBuilding(record.retentionRelease?.building)}`
                        : summary.phaseCount === 1
                          ? `${formatPhase(phase.name)} / ${formatBuilding(phase.building)}`
                          : `${summary.phaseCount} Phases`}
                    </Typography>
                    {record.packageType !== 'RETENTION_RELEASE' && isMultiPhasePackage(summary.phaseCount) && (
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        icon={<LayersRoundedIcon />}
                        label={`Multi-phase · ${summary.phaseCount} Phases / Buildings`}
                        sx={{ mt: 0.75, mb: 0.25, fontWeight: 750 }}
                      />
                    )}
                    {record.packageType === 'RETENTION_RELEASE' && (
                      <Chip
                        size="small"
                        color="success"
                        variant="outlined"
                        label="Retention Release"
                        sx={{ mt: 0.75, fontWeight: 750 }}
                      />
                    )}
                    {record.packageType !== 'RETENTION_RELEASE' && summary.phaseSummaries.map((scope) => (
                      <Typography
                        key={scope.phaseId}
                        variant="caption"
                        color="text.secondary"
                        component="div"
                      >
                        {formatPhase(scope.phaseCode)}: {scope.draws.map((draw) => [
                          draw.lotRange ? `Lots ${draw.lotRange}` : null,
                          draw.utilityCount > 0
                            ? `${draw.utilityCount} Utility ${draw.utilityCount === 1 ? 'row' : 'rows'}`
                            : null,
                          `Draw ${draw.drawIndex + 1}`,
                        ].filter(Boolean).join(' / ')).join(' · ')}
                      </Typography>
                    ))}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      component="div"
                      sx={{ mt: 0.5 }}
                    >
                      Created: {formatLongDate(record.createdAt)}
                    </Typography>
                  </TableCell>
                  <TableCell><PackageStatusChip status={record.status} /></TableCell>
                  <TableCell>
                    <Typography color="text.primary" sx={{ fontWeight: 'medium'}}>{job.builder}</Typography>
                    <Typography variant="body2" color="text.secondary">{job.community}</Typography>
                  </TableCell>
                  <TableCell>
                    {record.packageType === 'RETENTION_RELEASE'
                      ? `Available ${formatLongDate(record.retentionRelease?.availableDate)}`
                      : formatBillingPeriod(record)}
                  </TableCell>
                  <TableCell>
                    <Typography fontWeight={750}>
                      {record.packageType === 'RETENTION_RELEASE'
                        ? `${record.retentionRelease?.sourceLines?.length ?? 0} source lines`
                        : summary.lotCount > 0 ? summary.lotRange : 'No Lots'}
                    </Typography>
                    {record.packageType !== 'RETENTION_RELEASE' && summary.utilityCount > 0 && (
                      <Typography variant="caption" color="primary.main" component="div">
                        {summary.utilityCount} Utility {summary.utilityCount === 1 ? 'row' : 'rows'}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {record.packageType === 'RETENTION_RELEASE'
                        ? `Cutoff ${formatLongDate(record.retentionRelease?.sourceCutoffDate)}`
                        : formatPackageScopeEventTypes(summary.scopeEventTypes)}
                    </Typography>
                  </TableCell>
                  <TableCell><Typography fontWeight={750} sx={{ fontWeight: 'bold' }}>
                    {record.packageType === 'RETENTION_RELEASE'
                      ? `+${formatCurrency(record.retentionRelease?.retainedAmount)}`
                      : formatCurrency(summary.currentDraw)}
                  </Typography></TableCell>
                  <TableCell>
                    {record.packageType === 'RETENTION_RELEASE' ? (
                      <Typography variant="body2" color="success.dark" fontWeight={800}>
                        +{formatCurrency(record.retentionRelease?.retainedAmount)} retention
                      </Typography>
                    ) : (
                      <>
                        <Typography variant="body2">
                          Retention:{' '}
                          <Typography component="span" variant="inherit" color="error">
                            -{formatCurrency(summary.retention)}
                          </Typography>
                        </Typography>
                        <Typography variant="body2">
                          WRAP:{' '}
                          <Typography component="span" variant="inherit" color="error">
                            -{formatCurrency(summary.wrapInsurance)}
                          </Typography>
                        </Typography>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography fontWeight={850} sx={{ fontWeight: 'bold' }}>
                      {formatCurrency(summary.invoiceAmount)}
                    </Typography>
                    {summary.optionsTotal > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        Includes {formatCurrency(summary.optionsTotal)} options
                      </Typography>
                    )}
                    {summary.utilityTotal > 0 && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        Includes {formatCurrency(summary.utilityTotal)} Utility
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <PackageDocumentProgress job={job} documentState={documentState} />
                  </TableCell>
                  <TableCell><PackageQuickbooksStatus record={record} /></TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <PackageActionMenu
                      context={{ record, job, phase, phases, summary }}
                      canManage={canManage}
                      onOpen={(selected) => onOpen(
                        selected.record, selected.job, selected.phase,
                      )}
                      onAction={onAction}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      {filteredContexts.length === 0 && (
        <Card variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <ReceiptLongRoundedIcon color="disabled" sx={{ fontSize: 42 }} />
          <Typography fontWeight={750} sx={{ mt: 1 }}>
            {activeContexts.length === 0 ? 'No active Packages yet' : 'No Packages match these filters'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Cancelled Packages are kept in audit history, not in this table.
          </Typography>
          {activeContexts.length > 0 && (
            <Button onClick={onClearFilters} sx={{ mt: 1 }}>Clear filters</Button>
          )}
        </Card>
      )}
    </>
  )
}
