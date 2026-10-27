import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { formatCurrency, formatOptionPrice } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { useAuth } from '../../auth/context/useAuth.js'
import { usePurchaseOrderComparison } from '../hooks/usePurchaseOrders.js'
import { additionsFromImport } from '../services/purchaseOrderEmailRecord.js'
import {
  COMPARISON_STATUSES,
  describePriceResult,
  describePurchaseOrderDocument,
  describeImportResult,
  groupWorkOrders,
  importAction,
  priceCandidates,
  sortLinesByLotAndOption,
  summarizeComparison,
  uncoveredByLot,
  workOrderNeedsLook,
} from '../services/purchaseOrderRecord.js'
import ComparisonSummary from './review/ComparisonSummary.jsx'
import WorkOrderSection from './review/WorkOrderSection.jsx'

const PurchaseOrderImportDialog = lazy(() => import('./PurchaseOrderImportDialog.jsx'))
const PurchaseOrderPriceDialog = lazy(() => import('./PurchaseOrderPriceDialog.jsx'))
const OptionsChangeEmailDialog = lazy(() => import('./OptionsChangeEmailDialog.jsx'))

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

function UncoveredOptions({ uncovered }) {
  const [open, setOpen] = useState(false)
  const count = uncovered.reduce((total, lot) => total + lot.options.length, 0)

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <ButtonBase
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        sx={{
          width: '100%',
          px: 1.5,
          py: 1.25,
          gap: 1,
          justifyContent: 'flex-start',
          textAlign: 'left',
          bgcolor: 'action.hover',
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        }}
      >
        <ChevronRightRoundedIcon
          fontSize="small"
          sx={{
            color: 'text.secondary',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 150ms',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={850}>In the system, but not in any Purchase Order</Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            Selected for the Lots of this PDF, and no Purchase Order of the Job prints them.
          </Typography>
        </Box>
        <Chip size="small" variant="outlined" color="warning" label={`${count} ${count === 1 ? 'option' : 'options'}`} />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
          {uncovered.map((lot) => (
            <Box
              key={lot.lotId}
              sx={{ px: 2, py: 1.25, borderLeft: 4, borderLeftColor: 'warning.main' }}
            >
              <Typography variant="body2" fontWeight={800}>Lot {lot.lotNumber}</Typography>
              {lot.options.map((option) => (
                <Typography key={option.optionId} variant="body2" color="text.secondary">
                  <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                    {option.optionCode}
                  </Box>
                  {' · '}{option.optionName} · {formatOptionPrice(option.systemPrice, option.systemNotApplicable)}
                </Typography>
              ))}
            </Box>
          ))}
        </Stack>
      </Collapse>
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
  // One result the work orders are narrowed to (null = all), and the work orders the person
  // opened or closed by hand (the rest open when something in them needs a look).
  const [statusFilter, setStatusFilter] = useState(null)
  const [openOverrides, setOpenOverrides] = useState({})
  const [confirmingKey, setConfirmingKey] = useState(null)
  const [matching, setMatching] = useState(false)
  const { profile } = useAuth()
  // On a phone the review takes the whole screen: its columns need the width.
  const phone = useMediaQuery((theme) => theme.breakpoints.down('sm'))
  const canImport = canManage && IMPORT_ROLES.includes(profile?.role)
  // The lines being offered for import (null = dialog closed) and which start selected.
  const [importTarget, setImportTarget] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)
  const [importResult, setImportResult] = useState(null)
  // After options were added to the Sequence Sheet: the email that offers to tell
  // Purchasing and the Job Coordinator (null = closed), and what happened to it.
  const [emailTarget, setEmailTarget] = useState(null)
  const [emailNotice, setEmailNotice] = useState(null)
  // The line whose PDF price is being offered (null = dialog closed).
  const [priceTarget, setPriceTarget] = useState(null)
  const [adopting, setAdopting] = useState(false)
  const [priceError, setPriceError] = useState(null)
  const [needsDocumentsConfirmation, setNeedsDocumentsConfirmation] = useState(false)
  const [priceResult, setPriceResult] = useState(null)
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
    () => sortLinesByLotAndOption(lines.filter((line) => importAction(line) !== null)),
    [lines],
  )
  // The lines each button of the summary would add: those not in the Lot, and those not in the system.
  const importableByStatus = useMemo(() => ({
    NOT_IN_LOT: importable.filter((line) => line.status === 'NOT_IN_LOT'),
    MISSING_OPTION: importable.filter((line) => line.status === 'MISSING_OPTION'),
  }), [importable])
  // Narrowing to a result keeps the work orders that have it, all open.
  const visibleGroups = useMemo(
    () => (statusFilter
      ? groups.filter((group) => group.lines.some((line) => line.status === statusFilter))
      : groups),
    [groups, statusFilter],
  )
  const isOpen = (group) => (statusFilter ? true : openOverrides[group.key] ?? workOrderNeedsLook(group))
  const everyOpen = visibleGroups.every(isOpen)
  const setAllOpen = (open) => setOpenOverrides(
    Object.fromEntries(groups.map((group) => [group.key, open])),
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
      setEmailNotice(null)
      // The people who order and coordinate the options should know about the change.
      if (result.added.length > 0) setEmailTarget({ additions: additionsFromImport(result) })
    } catch (importFailure) {
      setImportError(importFailure.message)
    } finally {
      setImporting(false)
    }
  }

  const openPrice = (line) => {
    setPriceError(null)
    setNeedsDocumentsConfirmation(false)
    setPriceTarget(line)
  }
  const handleAdoptPrice = async (input) => {
    setAdopting(true)
    setPriceError(null)
    try {
      const result = await purchaseOrders.adoptPrice(input)
      setPriceResult({
        ...describePriceResult(result, {
          optionCode: priceTarget.optionCode,
          planCode: priceTarget.planCode,
          formatMoney: formatCurrency,
        }),
        skipped: result.skipped,
      })
      setPriceTarget(null)
    } catch (priceFailure) {
      // Draft Packages with a generated Release or Payment Schedule need an explicit yes.
      setNeedsDocumentsConfirmation(priceFailure.code === 'P0003')
      setPriceError(priceFailure.message)
    } finally {
      setAdopting(false)
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
      fullScreen={phone}
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

                {emailNotice && (
                  <Alert severity="success" onClose={() => setEmailNotice(null)}>
                    {emailNotice}
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

                {priceResult && (
                  <Alert severity={priceResult.severity} onClose={() => setPriceResult(null)}>
                    {priceResult.message}
                    {[...new Set(priceResult.skipped.map((item) => item.message))].map((message) => (
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

                {!comparison.error && !loadingComparison && (
                  <ComparisonSummary
                    summary={summary}
                    activeStatus={statusFilter}
                    onSelectStatus={setStatusFilter}
                    importableByStatus={canImport ? importableByStatus : undefined}
                    onImport={canImport ? openImport : undefined}
                  />
                )}

                {loadingComparison && (
                  <Box sx={{ py: 4, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress size={28} />
                  </Box>
                )}

                {visibleGroups.length > 0 && (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Typography variant="subtitle2" color="text.secondary">
                      {statusFilter
                        ? `${visibleGroups.length} of ${groups.length} work ${groups.length === 1 ? 'order' : 'orders'} showing “${COMPARISON_STATUSES[statusFilter].label}”`
                        : `${groups.length} work ${groups.length === 1 ? 'order' : 'orders'}, one per Lot`}
                    </Typography>
                    <Stack direction="row" spacing={0.5}>
                      {statusFilter && (
                        <Button size="small" onClick={() => setStatusFilter(null)} sx={{ textTransform: 'none' }}>
                          Show all
                        </Button>
                      )}
                      {groups.length > 1 && (
                        <Button
                          size="small"
                          color="inherit"
                          onClick={() => setAllOpen(!everyOpen)}
                          sx={{ textTransform: 'none' }}
                        >
                          {everyOpen ? 'Collapse all' : 'Expand all'}
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                )}

                {visibleGroups.map((group) => (
                  <WorkOrderSection
                    key={group.key}
                    group={group}
                    open={isOpen(group)}
                    onToggle={() => setOpenOverrides((current) => ({ ...current, [group.key]: !isOpen(group) }))}
                    statusFilter={statusFilter}
                    canManage={canManage}
                    confirming={confirmingKey === group.key}
                    onConfirm={handleConfirm}
                    onImportLine={canImport ? (line) => openImport([line]) : undefined}
                    onUsePrice={canImport ? openPrice : undefined}
                  />
                ))}

                {uncovered.length > 0 && !statusFilter && <UncoveredOptions uncovered={uncovered} />}
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

      {emailTarget && (
        <Suspense fallback={null}>
          <OptionsChangeEmailDialog
            kind="added"
            job={job}
            changes={emailTarget.additions}
            onClose={() => setEmailTarget(null)}
            onSent={(message) => {
              setEmailNotice(message)
              setEmailTarget(null)
            }}
          />
        </Suspense>
      )}

      {priceTarget && (
        <Suspense fallback={null}>
          <PurchaseOrderPriceDialog
            line={priceTarget}
            candidates={priceCandidates(priceTarget, comparison.lines)}
            adopting={adopting}
            error={priceError}
            needsDocumentsConfirmation={needsDocumentsConfirmation}
            onClose={() => setPriceTarget(null)}
            onConfirm={handleAdoptPrice}
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
