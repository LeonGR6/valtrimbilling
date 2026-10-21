import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded'
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { formatCurrency, formatOptionPrice } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { useAuth } from '../../auth/context/useAuth.js'
import { usePurchaseOrderComparison } from '../hooks/usePurchaseOrders.js'
import {
  COMPARISON_STATUSES,
  HEADER_STATUSES,
  describeHeaderMatch,
  describeImportResult,
  describePurchaseOrderDocument,
  groupWorkOrders,
  importAction,
  priceDifference,
  summarizeComparison,
  uncoveredByLot,
} from '../services/purchaseOrderRecord.js'

const PurchaseOrderImportDialog = lazy(() => import('./PurchaseOrderImportDialog.jsx'))

// Only these roles can change the Job's options.
const IMPORT_ROLES = ['ADMIN', 'PROJECT_MANAGEMENT']

function Waiting({ title, children }) {
  return (
    <DialogContent dividers sx={{ display: 'grid', placeItems: 'center', minHeight: 260 }}>
      <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <CircularProgress />
        <Typography fontWeight={750}>{title}</Typography>
        {children && (
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 380 }}>
            {children}
          </Typography>
        )}
      </Stack>
    </DialogContent>
  )
}

function signedCurrency(value) {
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`
}

function StatusChip({ line }) {
  const info = COMPARISON_STATUSES[line.status]
  if (!info) return null

  const difference = line.status === 'PRICE_DIFF' ? priceDifference(line) : null
  const label = difference === null ? info.label : `${info.label} (${signedCurrency(difference)} in the PDF)`
  return (
    <Tooltip title={info.hint}>
      <Chip
        size="small"
        color={info.color}
        variant={info.color === 'success' ? 'outlined' : 'filled'}
        label={label}
      />
    </Tooltip>
  )
}

function descriptionOf(line) {
  const [first, ...rest] = line.descriptionLines
  return { first: first ?? '—', rest: rest.join(' · ') }
}

function WorkOrderTable({ group, onlyDifferences, onImportLine }) {
  const lines = useMemo(
    () => group.lines
      .filter((line) => !onlyDifferences || line.status !== 'MATCH')
      .sort((a, b) =>
        COMPARISON_STATUSES[b.status].severity - COMPARISON_STATUSES[a.status].severity
        || a.optionCode.localeCompare(b.optionCode)),
    [group.lines, onlyDifferences],
  )

  if (lines.length === 0) return null

  return (
    <TableContainer>
      <Table size="small" aria-label={`Options of work order ${group.workOrderNo}`}>
        <TableHead>
          <TableRow>
            <TableCell>Option</TableCell>
            <TableCell>In the PDF</TableCell>
            <TableCell align="right">PDF price</TableCell>
            <TableCell>In the system</TableCell>
            <TableCell align="right">System price</TableCell>
            <TableCell>Result</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.map((line) => {
            const description = descriptionOf(line)
            return (
              <TableRow key={line.lineId} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography variant="body2" fontWeight={750}>{line.optionCode}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Ref {line.referenceNo}
                  </Typography>
                </TableCell>
                <TableCell sx={{ maxWidth: 280 }}>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    {description.first}
                  </Typography>
                  {description.rest && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      title={description.rest}
                      sx={{ display: 'block', overflowWrap: 'anywhere' }}
                    >
                      {description.rest}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Typography variant="body2" fontWeight={700}>
                    {formatCurrency(line.poUnitPrice)}
                  </Typography>
                  {line.quantity !== 1 && (
                    <Typography variant="caption" color="text.secondary">
                      × {line.quantity}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ maxWidth: 280 }}>
                  {line.optionName ? (
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      {line.optionName}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">—</Typography>
                  )}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
                    {line.conflictingPoPrices && (
                      <Tooltip title="Purchase Orders of other Lots of this Plan print a different price for this option. An option has one price per Plan.">
                        <WarningAmberRoundedIcon color="warning" fontSize="small" />
                      </Tooltip>
                    )}
                    <Typography variant="body2" fontWeight={700}>
                      {line.optionName || line.systemPrice !== null
                        ? formatOptionPrice(line.systemPrice, line.systemNotApplicable)
                        : '—'}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <StatusChip line={line} />
                    {onImportLine && importAction(line) && (
                      <Button
                        size="small"
                        startIcon={<PlaylistAddRoundedIcon />}
                        aria-label={`Add ${line.optionCode} to Lot ${line.lotNumber}`}
                        onClick={() => onImportLine(line)}
                      >
                        Add
                      </Button>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function WorkOrder({ group, onlyDifferences, canManage, confirming, onConfirm, onImportLine }) {
  const note = describeHeaderMatch(group)
  const header = HEADER_STATUSES[group.headerStatus]
  const summary = summarizeComparison(group.lines)
  const printed = [
    group.printed.lot ? `Lot ${group.printed.lot}` : null,
    group.printed.phase ? `Phase ${group.printed.phase}` : null,
    group.printed.plan ? `Plan ${group.printed.plan}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{
          p: 1.5,
          alignItems: { sm: 'center' },
          bgcolor: 'action.hover',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={850}>
            {group.system ? `Lot ${group.system.lotNumber}` : printed || 'Work order'}
            {group.system && (
              <Typography component="span" color="text.secondary" fontWeight={500}>
                {' · '}Phase {group.system.phaseCode} · Plan {group.system.planCode}
              </Typography>
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Work order {group.workOrderNo}
            {group.system && printed ? ` · The PDF says ${printed}` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          {header && group.headerStatus !== 'resolved' && (
            <Chip size="small" color={header.color} label={header.label} />
          )}
          <Chip
            size="small"
            variant="outlined"
            color={summary.attention > 0 ? 'warning' : 'success'}
            label={summary.attention > 0
              ? `${summary.attention} of ${summary.total} to review`
              : `${summary.total} ${summary.total === 1 ? 'option matches' : 'options match'}`}
          />
          {group.headerStatus === 'suggested' && canManage && (
            <Button
              size="small"
              variant="contained"
              disableElevation
              startIcon={confirming ? <CircularProgress size={14} color="inherit" /> : <TaskAltRoundedIcon />}
              disabled={confirming}
              onClick={() => onConfirm(group)}
            >
              Confirm match
            </Button>
          )}
        </Stack>
      </Stack>
      {note && (
        <Alert
          severity={group.headerStatus === 'suggested' ? 'info' : 'warning'}
          sx={{ borderRadius: 0 }}
        >
          {note}
        </Alert>
      )}
      <WorkOrderTable group={group} onlyDifferences={onlyDifferences} onImportLine={onImportLine} />
    </Box>
  )
}

/**
 * Reads a Purchase Order PDF (analyzing it first when it has not been) and shows
 * each option it prints against what the system holds for that Lot. It only
 * informs: nothing here blocks a Package or changes a price.
 */
export default function PurchaseOrderReviewDialog({
  job,
  document,
  purchaseOrders,
  canManage,
  position = null,
  onClose,
}) {
  const analysis = purchaseOrders.analysesByDocumentId[document.id] ?? null
  const { analyze, rematch, confirmHeader } = purchaseOrders
  const analyzing = purchaseOrders.analyzingDocumentId === document.id
  const [error, setError] = useState(null)
  const [onlyDifferences, setOnlyDifferences] = useState(false)
  const [confirmingKey, setConfirmingKey] = useState(null)
  const [matching, setMatching] = useState(false)
  const { profile } = useAuth()
  const canImport = canManage && IMPORT_ROLES.includes(profile?.role)
  // The lines being offered for import (null = dialog closed) and which start selected.
  const [importTarget, setImportTarget] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)
  const [importResult, setImportResult] = useState(null)
  // One analysis per opening: React may run the effect twice, and a second request
  // would be rejected as already running.
  const requested = useRef(false)
  const needsAnalysis = canManage && (!analysis || analysis.status === 'failed')

  useEffect(() => {
    if (!needsAnalysis || requested.current) return
    requested.current = true
    analyze(document).catch((analysisError) => setError(analysisError.message))
  }, [analyze, document, needsAnalysis])

  const isAnalyzed = analysis?.status === 'analyzed'
  const comparison = usePurchaseOrderComparison(isAnalyzed ? job.id : null, purchaseOrders.revision)
  const lines = useMemo(
    () => comparison.lines.filter((line) => line.documentId === document.id),
    [comparison.lines, document.id],
  )
  const groups = useMemo(() => groupWorkOrders(lines), [lines])
  const summary = useMemo(() => summarizeComparison(lines), [lines])
  const uncovered = useMemo(
    () => uncoveredByLot(
      comparison.uncovered,
      groups.flatMap((group) => (group.system ? [group.system.lotId] : [])),
    ),
    [comparison.uncovered, groups],
  )

  const run = async (action) => {
    setError(null)
    try {
      await action()
    } catch (actionError) {
      setError(actionError.message)
    }
  }

  const handleConfirm = (group) => run(async () => {
    setConfirmingKey(group.key)
    try {
      await confirmHeader({ document, workOrderNo: group.workOrderNo })
    } finally {
      setConfirmingKey(null)
    }
  })

  const handleRematch = () => run(async () => {
    setMatching(true)
    try {
      await rematch(document)
    } finally {
      setMatching(false)
    }
  })

  const importable = useMemo(
    () => lines.filter((line) => importAction(line) !== null),
    [lines],
  )
  const openImport = (selectedLines) => {
    setImportError(null)
    setImportTarget({ ids: selectedLines.map((line) => line.lineId) })
  }
  const handleImport = async (lineIds) => {
    setImporting(true)
    setImportError(null)
    try {
      const result = await purchaseOrders.importOptions(lineIds)
      setImportResult(result)
      setImportTarget(null)
    } catch (importFailure) {
      setImportError(importFailure.message)
    } finally {
      setImporting(false)
    }
  }

  const handleReanalyze = () => run(() => analyze(document, { force: true }))

  const card = describePurchaseOrderDocument(analysis, isAnalyzed ? summary : null, analyzing)
  const jobCode = job.code ?? job.id
  const loadingComparison = isAnalyzed && comparison.loading && lines.length === 0

  return (
    <Dialog
      open
      fullWidth
      maxWidth="xl"
      scroll="paper"
      onClose={onClose}
      aria-labelledby="purchase-order-title"
    >
      <DialogTitle
        id="purchase-order-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 1.5 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="span" variant="h6" fontWeight={850} sx={{ display: 'block' }}>
            Purchase Order
          </Typography>
          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            noWrap
            sx={{ display: 'block' }}
          >
            {position ? `Document ${position.index} of ${position.total} · ` : ''}
            Job #{jobCode} · {document.name}
          </Typography>
        </Box>
        {card.status && <Chip size="small" color={card.status.color} label={card.status.label} />}
        <IconButton aria-label="Close" onClick={onClose}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>

      {(analyzing || analysis?.status === 'analyzing') && (
        <Waiting title="Reading the Purchase Order…">
          Finding the options in the PDF and matching each Lot with this Job.
          This takes a few seconds.
        </Waiting>
      )}

      {!analyzing && !analysis && !needsAnalysis && (
        <DialogContent dividers sx={{ minHeight: 160 }}>
          <Alert severity="info">
            This Purchase Order has not been analyzed yet. Ask an Admin, Accounting or
            Project Management user to open it.
          </Alert>
        </DialogContent>
      )}

      {!analyzing && analysis && analysis.status !== 'analyzing' && (
        <DialogContent dividers>
          <Stack spacing={2}>
            {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
            {purchaseOrders.error && <Alert severity="error">{purchaseOrders.error}</Alert>}

            {analysis.status === 'failed' && (
              <Alert severity="error">
                {analysis.error ?? 'The Purchase Order could not be analyzed.'}
              </Alert>
            )}

            {analysis.status === 'not_option_po' && (
              <Alert severity="info">
                {analysis.error
                  ?? 'This PDF is not a Purchase Order of options, so there is nothing to compare.'}
                {' '}Payment Schedules go in their own card.
              </Alert>
            )}

            {isAnalyzed && (
              <>
                {comparison.error && <Alert severity="error">{comparison.error}</Alert>}

                {!comparison.error && !loadingComparison && (
                  <Alert
                    severity={summary.attention > 0 ? 'warning' : 'success'}
                    icon={summary.attention > 0 ? undefined : <CompareArrowsRoundedIcon />}
                  >
                    {summary.total === 0
                      ? 'No options from this PDF are current: newer Purchase Orders replace them.'
                      : summary.attention > 0
                        ? `${summary.attention} of ${summary.total} options need a look. This only informs: nothing is blocked and nothing was changed.`
                        : `All ${summary.total} options in this PDF match the system.`}
                  </Alert>
                )}

                {importResult && (
                  <Alert
                    severity={describeImportResult(importResult).severity}
                    onClose={() => setImportResult(null)}
                  >
                    {describeImportResult(importResult).message}
                    {[...new Set(importResult.skipped.map((item) => item.message))].map((message) => (
                      <Typography key={message} variant="body2">• {message}</Typography>
                    ))}
                  </Alert>
                )}

                {analysis.issueCount > 0 && (
                  <Alert severity="warning">
                    <Typography variant="body2" fontWeight={700}>
                      The PDF has {analysis.issueCount === 1 ? 'one thing' : `${analysis.issueCount} things`} that
                      do not add up
                    </Typography>
                    {analysis.issues.map((issue, index) => (
                      <Typography key={`${issue.code}-${index}`} variant="body2">
                        • {issue.message}
                        {issue.workOrderNo ? ` (work order ${issue.workOrderNo})` : ''}
                      </Typography>
                    ))}
                  </Alert>
                )}

                {summary.total > 0 && (
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    {Object.entries(COMPARISON_STATUSES)
                      .filter(([key]) => summary.byStatus[key] > 0)
                      .sort(([, a], [, b]) => b.severity - a.severity)
                      .map(([key, info]) => (
                        <Tooltip key={key} title={info.hint}>
                          <Chip
                            size="small"
                            color={info.color}
                            variant={info.color === 'success' ? 'outlined' : 'filled'}
                            label={`${summary.byStatus[key]} · ${info.label}`}
                          />
                        </Tooltip>
                      ))}
                    <Box sx={{ flex: 1 }} />
                    {canImport && importable.length > 0 && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<PlaylistAddRoundedIcon />}
                        onClick={() => openImport(importable)}
                      >
                        Add missing options ({importable.length})
                      </Button>
                    )}
                    <FormControlLabel
                      sx={{ mx: 0 }}
                      control={(
                        <Switch
                          size="small"
                          checked={onlyDifferences}
                          onChange={(event) => setOnlyDifferences(event.target.checked)}
                        />
                      )}
                      label="Only differences"
                    />
                  </Stack>
                )}

                {loadingComparison && (
                  <Box sx={{ py: 4, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress size={28} />
                  </Box>
                )}

                {groups.map((group) => (
                  <WorkOrder
                    key={group.key}
                    group={group}
                    onlyDifferences={onlyDifferences}
                    canManage={canManage}
                    confirming={confirmingKey === group.key}
                    onConfirm={handleConfirm}
                    onImportLine={canImport ? (line) => openImport([line]) : undefined}
                  />
                ))}

                {uncovered.length > 0 && (
                  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}>
                    <Typography fontWeight={850}>
                      In the system, but not in any Purchase Order
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      These options are selected for the Lots of this PDF, and no Purchase
                      Order of the Job prints them.
                    </Typography>
                    <Stack spacing={1}>
                      {uncovered.map((lot) => (
                        <Box key={lot.lotId}>
                          <Typography variant="body2" fontWeight={750}>Lot {lot.lotNumber}</Typography>
                          {lot.options.map((option) => (
                            <Typography key={option.optionId} variant="body2" color="text.secondary">
                              {option.optionCode} · {option.optionName} ·{' '}
                              {formatOptionPrice(option.systemPrice, option.systemNotApplicable)}
                            </Typography>
                          ))}
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
      )}

      {importTarget && (
        <Suspense fallback={null}>
          <PurchaseOrderImportDialog
            lines={importable}
            initialSelectedIds={importTarget.ids}
            importing={importing}
            error={importError}
            onClose={() => setImportTarget(null)}
            onConfirm={handleImport}
          />
        </Suspense>
      )}

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        {canManage && isAnalyzed && (
          <Tooltip title="Match the Purchase Order lines with the Job's Lots again, for example after adding a Lot.">
            <span>
              <Button
                color="inherit"
                startIcon={matching ? <CircularProgress size={16} /> : <CompareArrowsRoundedIcon />}
                disabled={matching || analyzing}
                onClick={handleRematch}
              >
                Match again
              </Button>
            </span>
          </Tooltip>
        )}
        {canManage && analysis && analysis.status !== 'analyzing' && (
          <Tooltip title="Read the PDF again.">
            <span>
              <Button
                color="inherit"
                startIcon={<RefreshRoundedIcon />}
                disabled={analyzing || matching}
                onClick={handleReanalyze}
              >
                Analyze again
              </Button>
            </span>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" disableElevation onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
