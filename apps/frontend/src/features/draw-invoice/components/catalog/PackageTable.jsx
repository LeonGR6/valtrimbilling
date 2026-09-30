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
  Typography,
} from '@mui/material'
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
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
import { PackageStatusChip } from '../shared/PackageUi.jsx'

const packageTableColumns = [
  { key: 'package', width: 220 },
  { key: 'builder', width: 180 },
  { key: 'billing-period', width: 130 },
  { key: 'lots', width: 105 },
  { key: 'current-draw', width: 135 },
  { key: 'retention-wrap', width: 180 },
  { key: 'invoice-amount', width: 140 },
  { key: 'documents', width: 125 },
  { key: 'status', width: 155 },
  { key: 'action', width: 140 },
]

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
      <ButtonGroup size="small" variant="contained" disableElevation>
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

export default function PackageTable({
  filteredContexts,
  activeContexts,
  documentState,
  canManage,
  onOpen,
  onAction,
  onClearFilters,
}) {
  return (
    <>
      <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', mt: 1.5 }}>
        <TableContainer>
          <Table sx={{ minWidth: packageTableMinimumWidth, tableLayout: 'fixed' }}>
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
                <TableCell>Package</TableCell>
                <TableCell>Builder/Community</TableCell>
                <TableCell>Billing Period</TableCell>
                <TableCell>Lots/Scopes</TableCell>
                <TableCell>Current Draw</TableCell>
                <TableCell>Retention / WRAP Insurance</TableCell>
                <TableCell>Invoice Amount</TableCell>
                <TableCell>Documents</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredContexts.map(({ record, job, phase, phases, summary }) => (
                <TableRow
                  key={record.id}
                  hover
                  onClick={() => onOpen(record, job, phase)}
                  sx={{ cursor: 'pointer' }}
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
                        fontSize: '1rem',
                        textTransform: 'none',
                        justifyContent: 'flex-start',
                      }}
                    >
                      {record.packageNumber}
                    </Button>
                    <Typography variant="body2" color="text.secondary">
                      Job #{job.code} · {summary.phaseCount === 1
                        ? `${formatPhase(phase.name)} / ${formatBuilding(phase.building)}`
                        : `${summary.phaseCount} Phases`}
                    </Typography>
                    {summary.phaseSummaries.map((scope) => (
                      <Typography
                        key={scope.phaseId}
                        variant="caption"
                        color="text.secondary"
                        component="div"
                      >
                        {formatPhase(scope.phaseCode)}: {scope.draws.map(
                          (draw) => `Lots ${draw.lotRange} / Draw ${draw.drawIndex + 1}`,
                        ).join(' · ')}
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
                  <TableCell>
                    <Typography color="text.primary" sx={{ fontWeight: 'medium'}}>{job.builder}</Typography>
                    <Typography variant="body2" color="text.secondary">{job.community}</Typography>
                  </TableCell>
                  <TableCell>{formatBillingPeriod(record)}</TableCell>
                  <TableCell>
                    <Typography fontWeight={750}>{summary.lotRange}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatPackageScopeEventTypes(summary.scopeEventTypes)}
                    </Typography>
                  </TableCell>
                  <TableCell><Typography fontWeight={750} sx={{ fontWeight: 'bold' }}>
                    {formatCurrency(summary.currentDraw)}
                  </Typography></TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>
                    <PackageDocumentProgress job={job} documentState={documentState} />
                  </TableCell>
                  <TableCell><PackageStatusChip status={record.status} /></TableCell>
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
        <Card variant="outlined" sx={{ p: 5, textAlign: 'center', mt: 2 }}>
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
