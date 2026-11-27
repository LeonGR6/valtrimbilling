import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import { validatePaymentScheduleMapping } from '../schemas/paymentScheduleMappingSchema.js'
import {
  applyPhaseMap,
  buildMapping,
  describeAiReading,
  initialCells,
  initialPhaseMap,
  initialSummaryRows,
  initialUtilityCells,
  lotPhaseIndex,
  unmatchedPhases,
} from '../services/paymentScheduleRecord.js'
import PaymentSchedulePdfPages from './PaymentSchedulePdfPages.jsx'
import PaymentScheduleSummaryPanel from './PaymentScheduleSummaryPanel.jsx'

const EDITABLE_STATUSES = ['needs_review', 'confirmed']
const NO_REMOVED = new Set()
const NO_PHASES = []
const NO_LOTS = []

export default function PaymentScheduleEditor({
  template,
  file,
  jobPhases = NO_PHASES,
  jobLots = NO_LOTS,
  canManage,
  onConfirm,
  onReanalyze,
  onReadWithAi,
  onForgetLayout,
  onClose,
}) {
  const [cells] = useState(() => initialCells(template))
  const [removedKeys, setRemovedKeys] = useState(NO_REMOVED)
  const [selectedKey, setSelectedKey] = useState(null)
  const [selectedLotId, setSelectedLotId] = useState(null)
  const jobPhaseCodes = useMemo(() => jobPhases.map(({ code }) => code), [jobPhases])
  // Which Phases have each Lot of the Job, for a schedule that prints no Phase.
  const lotPhases = useMemo(() => lotPhaseIndex(jobLots), [jobLots])
  // Which Phase of the Job each Phase printed in the PDF stands for.
  const [phaseMap, setPhaseMap] = useState(() => initialPhaseMap(cells, jobPhaseCodes, lotPhases))
  const [acknowledged, setAcknowledged] = useState(false)
  // Previously Invoiced and This Request boxes (matrix schedules), and whether a
  // Package fills them.
  const summaryRows = useMemo(() => initialSummaryRows(template), [template])
  const [fillSummary, setFillSummary] = useState(true)
  // Utility amounts printed per Lot, and whether the schedule keeps them.
  const [utilityCells] = useState(() => initialUtilityCells(template))
  const [keepUtility, setKeepUtility] = useState(true)
  // A layout read with AI can be remembered for the builder when it is confirmed.
  const aiReading = describeAiReading(template)
  const [rememberLayout, setRememberLayout] = useState(true)
  const [forgetState, setForgetState] = useState({ status: 'idle', message: null })
  const [saving, setSaving] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [error, setError] = useState(null)

  const readOnly = !canManage || !EDITABLE_STATUSES.includes(template.status)
  const canRemember = !readOnly && aiReading?.source === 'ai'
  const busy = saving || reanalyzing
  const activeCells = useMemo(
    () => applyPhaseMap(cells.filter((cell) => !removedKeys.has(cell.key)), phaseMap, lotPhases),
    [cells, lotPhases, phaseMap, removedKeys],
  )
  // Only worth saying when the Job's Phases are known.
  const unmatched = useMemo(
    () => (jobPhaseCodes.length > 0 ? unmatchedPhases(cells, phaseMap, jobPhaseCodes) : []),
    [cells, jobPhaseCodes, phaseMap],
  )
  // Stored under the Job Phase of their Lot, like the draw cells.
  const activeUtilityCells = useMemo(
    () => (keepUtility ? applyPhaseMap(utilityCells, phaseMap, lotPhases) : []),
    [keepUtility, lotPhases, phaseMap, utilityCells],
  )
  const mapping = useMemo(
    () => buildMapping(
      template.layout,
      activeCells,
      fillSummary ? summaryRows : null,
      activeUtilityCells,
    ),
    [activeCells, activeUtilityCells, fillSummary, summaryRows, template.layout],
  )
  const validation = useMemo(
    () => validatePaymentScheduleMapping(mapping, template.pageCount),
    [mapping, template.pageCount],
  )
  // A confirmed template was already checked; its warnings need no new tick. What the AI
  // read is always ticked, issues or not.
  const needsAcknowledgement = (template.issues.length > 0 || Boolean(template.ai))
    && template.status !== 'confirmed'
  const canConfirm = !readOnly
    && !busy
    && validation.success
    && (!needsAcknowledgement || acknowledged)

  const selectCell = (key) => {
    setSelectedKey((current) => (current === key ? null : key))
    setSelectedLotId(null)
  }
  const selectLot = (lotId) => {
    setSelectedLotId((current) => (current === lotId ? null : lotId))
    setSelectedKey(null)
  }
  const toggleRemoved = (key) => {
    setRemovedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleConfirm = async () => {
    setSaving(true)
    setError(null)
    try {
      await onConfirm({
        templateId: template.id,
        mapping,
        rememberLayout: canRemember && rememberLayout,
      })
    } catch (confirmError) {
      setError(confirmError.message)
      setSaving(false)
    }
  }

  const handleReadWithAi = async () => {
    setReanalyzing(true)
    setError(null)
    try {
      await onReadWithAi()
    } catch (analysisError) {
      setError(analysisError.message)
      setReanalyzing(false)
    }
  }

  const handleForgetLayout = async () => {
    setForgetState({ status: 'working', message: null })
    try {
      await onForgetLayout(aiReading.recipeId)
      setForgetState({
        status: 'done',
        message: 'Forgotten. The next schedules with this layout need the AI again.',
      })
    } catch (forgetError) {
      setForgetState({ status: 'idle', message: forgetError.message })
    }
  }

  const handleReanalyze = async () => {
    setReanalyzing(true)
    setError(null)
    try {
      await onReanalyze()
    } catch (analysisError) {
      setError(analysisError.message)
      setReanalyzing(false)
    }
  }

  return (
    <>
      <DialogContent dividers sx={{ p: 0, bgcolor: 'action.hover' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 420px' },
            alignItems: 'start',
          }}
        >
          <Box sx={{ p: { xs: 1.5, sm: 2.5 }, minWidth: 0 }}>
            <PaymentSchedulePdfPages
              file={file}
              template={template}
              cells={cells}
              removedKeys={removedKeys}
              selectedKey={selectedKey}
              selectedLotId={selectedLotId}
              summaryRows={fillSummary ? summaryRows : null}
              utilityCells={keepUtility ? utilityCells : null}
              onSelectCell={selectCell}
            />
          </Box>
          <Box
            sx={{
              p: 2.5,
              bgcolor: 'background.paper',
              borderLeft: { lg: 1 },
              borderTop: { xs: 1, lg: 0 },
              borderColor: 'divider',
              position: { lg: 'sticky' },
              top: 0,
              maxHeight: { lg: 'calc(100vh - 140px)' },
              overflowY: 'auto',
            }}
          >
            <Stack spacing={2}>
              {!canManage && (
                <Alert severity="info">
                  Your role can view this Payment Schedule but not change it.
                </Alert>
              )}
              {template.status === 'confirmed' && canManage && (
                <Alert severity="success">
                  This Payment Schedule is confirmed. Saving changes replaces its amounts.
                </Alert>
              )}
              <Typography variant="body2" color="text.secondary">
                The yellow boxes are the amounts a Package will highlight. Check that
                each one sits on the right amount. Click a box or a Lot to inspect it.
              </Typography>
              <PaymentScheduleSummaryPanel
                template={template}
                cells={cells}
                removedKeys={removedKeys}
                activeCells={activeCells}
                selectedKey={selectedKey}
                selectedLotId={selectedLotId}
                phaseMap={phaseMap}
                jobPhases={jobPhases}
                lotPhases={lotPhases}
                unmatchedPhases={unmatched}
                summaryRows={summaryRows}
                fillSummary={fillSummary}
                onFillSummaryChange={setFillSummary}
                onSearchSummary={handleReanalyze}
                utilityCells={activeUtilityCells}
                foundUtilityCount={utilityCells.length}
                keepUtility={keepUtility}
                onKeepUtilityChange={setKeepUtility}
                acknowledged={acknowledged}
                validation={validation}
                readOnly={readOnly || busy}
                onSelectCell={selectCell}
                onSelectLot={selectLot}
                onToggleRemoved={toggleRemoved}
                onRestoreAll={() => setRemovedKeys(NO_REMOVED)}
                onPhaseChange={(printed, phase) => setPhaseMap((current) => ({
                  ...current,
                  [printed]: phase,
                }))}
                onAcknowledgeChange={setAcknowledged}
              />
              {canRemember && (
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={rememberLayout}
                      onChange={(event) => setRememberLayout(event.target.checked)}
                    />
                  )}
                  label="Remember this layout for the builder: its next schedules are read without AI"
                />
              )}
              {aiReading?.source === 'recipe' && aiReading.recipeId && canManage && (
                <Box>
                  {forgetState.status === 'done' ? (
                    <Alert severity="success">{forgetState.message}</Alert>
                  ) : (
                    <Button
                      size="small"
                      color="inherit"
                      disabled={busy || forgetState.status === 'working'}
                      onClick={handleForgetLayout}
                    >
                      {forgetState.status === 'working' ? 'Forgetting…' : 'Forget this layout'}
                    </Button>
                  )}
                  {forgetState.status === 'idle' && forgetState.message && (
                    <Alert severity="error" sx={{ mt: 1 }}>{forgetState.message}</Alert>
                  )}
                </Box>
              )}
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 1.5, sm: 3 }, py: 1.5, gap: 0.5, flexWrap: 'wrap' }}>
        <Box sx={{ mr: 'auto' }}>
          {canManage && EDITABLE_STATUSES.includes(template.status) && (
            <Button
              startIcon={<RefreshRoundedIcon />}
              disabled={busy}
              onClick={handleReanalyze}
            >
              {reanalyzing ? 'Analyzing…' : 'Analyze again'}
            </Button>
          )}
          {canManage && EDITABLE_STATUSES.includes(template.status) && aiReading?.source === 'recipe' && (
            <Button
              startIcon={<AutoAwesomeRoundedIcon />}
              disabled={busy}
              onClick={handleReadWithAi}
            >
              Read with AI instead
            </Button>
          )}
        </Box>
        <Button onClick={onClose} disabled={saving}>
          {readOnly ? 'Close' : 'Cancel'}
        </Button>
        {!readOnly && (
          <Button
            variant="contained"
            startIcon={<TaskAltRoundedIcon />}
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {saving
              ? 'Saving…'
              : template.status === 'confirmed' ? 'Save changes' : 'Confirm Payment Schedule'}
          </Button>
        )}
      </DialogActions>
    </>
  )
}
