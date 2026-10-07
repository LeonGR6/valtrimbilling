import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  DialogActions,
  DialogContent,
  Stack,
} from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import { validateReleaseMapping } from '../schemas/releaseMappingSchema.js'
import {
  buildMapping,
  initialPlacements,
  placementFromSuggestion,
} from '../services/releaseTemplateRecord.js'
import ReleasePdfPages from './ReleasePdfPages.jsx'
import ReleasePlacementPanel from './ReleasePlacementPanel.jsx'

const EDITABLE_STATUSES = ['needs_review', 'confirmed']

export default function ReleaseTemplateEditor({
  template,
  file,
  canManage,
  onConfirm,
  onReanalyze,
  onClose,
}) {
  const [releaseType, setReleaseType] = useState(template.releaseType ?? '')
  const [placements, setPlacements] = useState(() => initialPlacements(template))
  const [selectedVariable, setSelectedVariable] = useState(null)
  const [saving, setSaving] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [error, setError] = useState(null)

  const isSuperseded = template.status === 'superseded'
  const readOnly = !canManage || !EDITABLE_STATUSES.includes(template.status)
  const busy = saving || reanalyzing
  const mapping = useMemo(() => buildMapping(placements), [placements])
  const validation = useMemo(
    () => validateReleaseMapping(mapping, template.pageCount),
    [mapping, template.pageCount],
  )
  const canConfirm = !readOnly && !busy && Boolean(releaseType) && validation.success

  const updatePlacement = (variable, patch) => {
    setPlacements((current) => current.map((placement) => (
      placement.variable === variable ? { ...placement, ...patch } : placement
    )))
  }

  const placeVariable = (variable) => {
    setPlacements((current) => (
      current.some((placement) => placement.variable === variable)
        ? current
        : [...current, placementFromSuggestion(template, variable)]
    ))
    setSelectedVariable(variable)
  }

  const removeVariable = (variable) => {
    setPlacements((current) => current.filter((placement) => placement.variable !== variable))
    setSelectedVariable((current) => (current === variable ? null : current))
  }

  const handleConfirm = async () => {
    setSaving(true)
    setError(null)
    try {
      await onConfirm({ templateId: template.id, releaseType, mapping })
    } catch (confirmError) {
      setError(confirmError.message)
      setSaving(false)
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
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 400px' },
            alignItems: 'start',
          }}
        >
          <Box sx={{ p: { xs: 1.5, sm: 2.5 }, minWidth: 0 }}>
            <ReleasePdfPages
              file={file}
              pageSizes={template.pageSizes}
              placements={placements}
              selectedVariable={selectedVariable}
              readOnly={readOnly || busy}
              onSelect={setSelectedVariable}
              onChange={updatePlacement}
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
              {isSuperseded && (
                <Alert severity="info">
                  A newer template replaced this one for the same Release type. It is shown for reference only.
                </Alert>
              )}
              {!canManage && !isSuperseded && (
                <Alert severity="info">
                  Your role can view this template but not change it.
                </Alert>
              )}
              {template.status === 'confirmed' && canManage && (
                <Alert severity="success">
                  This template is confirmed. Saving changes replaces its mapping.
                </Alert>
              )}
              <ReleasePlacementPanel
                template={template}
                releaseType={releaseType}
                placements={placements}
                selectedVariable={selectedVariable}
                validation={validation}
                readOnly={readOnly || busy}
                onReleaseTypeChange={setReleaseType}
                onSelect={setSelectedVariable}
                onPlace={placeVariable}
                onRemove={removeVariable}
                onUpdate={updatePlacement}
              />
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 1.5, sm: 3 }, py: 1.5, gap: 0.5, flexWrap: 'wrap' }}>
        {canManage && template.status === 'needs_review' && (
          <Button
            startIcon={<RefreshRoundedIcon />}
            disabled={busy}
            onClick={handleReanalyze}
            sx={{ mr: 'auto' }}
          >
            {reanalyzing ? 'Analyzing…' : 'Analyze again'}
          </Button>
        )}
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
              : template.status === 'confirmed' ? 'Save changes' : 'Confirm template'}
          </Button>
        )}
      </DialogActions>
    </>
  )
}
