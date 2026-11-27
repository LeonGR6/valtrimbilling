import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import useBulkPlanOptions from '../../hooks/useBulkPlanOptions.js'
import BulkPlanOptionsBar from './BulkPlanOptionsBar.jsx'
import BulkPlanOptionsGrid from './BulkPlanOptionsGrid.jsx'

function count(number, singular, pluralForm = `${singular}s`) {
  return `${number} ${number === 1 ? singular : pluralForm}`
}

function deletionText({ plansDeleted, optionsDeleted, optionsDeletedWithPlans }) {
  const plans = plansDeleted > 0
    ? `${count(plansDeleted, 'plan')}${optionsDeletedWithPlans > 0 ? ` (with ${count(optionsDeletedWithPlans, 'option')})` : ''}`
    : ''
  const options = optionsDeleted > 0 ? count(optionsDeleted, 'option') : ''
  return [plans, options].filter(Boolean).join(' and ')
}

/**
 * Plans & options while they are being edited in bulk: the bar with what saving would do, and the
 * grid with what the Job has and the rows to add. It takes the place of the list until it is saved
 * or left. `onSave(changes, summary)` saves; it throws when it fails, and the rows stay. `usage` says which
 * Plans and Options Lots use: those cannot be deleted.
 */
export default function BulkPlanOptionsMode({ plans, usage, onSave, onClose }) {
  const bulk = useBulkPlanOptions(plans)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const topRef = useRef(null)
  const { evaluation } = bulk
  const { summary } = evaluation
  const hasDeletions = summary.plansDeleted + summary.optionsDeleted > 0
  const deletionSummary = useMemo(() => deletionText(summary), [summary])

  // Starts with the grid in view, on the first cell to add.
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  const save = async () => {
    setConfirmingDelete(false)
    setSaving(true)
    try {
      // The summary says how many repeated Options the grid left out, which the database never sees.
      await onSave(evaluation.payload, summary)
    } catch {
      // The page tells the person; the rows stay so nothing typed is lost.
      setSaving(false)
    }
  }

  return (
    <Box ref={topRef} sx={{ scrollMarginTop: 8 }}>
      <BulkPlanOptionsBar
        summary={summary}
        canSave={evaluation.canSave}
        hasContent={bulk.hasContent}
        saving={saving}
        selectedCount={bulk.selected.size}
        onDeleteSelected={bulk.deleteSelected}
        onClearSelection={bulk.clearSelection}
        onSave={() => (hasDeletions ? setConfirmingDelete(true) : save())}
        onDiscard={onClose}
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
        <Stack
          direction="row"
          spacing={1.25}
          sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider', alignItems: 'center' }}
        >
          <Typography component="h2" variant="subtitle1" fontWeight={700}>
            Plans &amp; options
          </Typography>
          <Chip label="Bulk edit" size="small" color="primary" variant="outlined" />
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
            A Plan or Option that Lots use cannot be deleted. Prices are not changed here.
          </Typography>
        </Stack>
        <BulkPlanOptionsGrid bulk={bulk} usage={usage} />
      </Box>

      <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {deletionSummary}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            They leave the Job when you save. No Lot uses them, and the rest of the changes are saved at the
            same time.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setConfirmingDelete(false)} sx={{ textTransform: 'none' }}>
            Keep editing
          </Button>
          <Button color="error" variant="contained" disableElevation onClick={save} sx={{ textTransform: 'none' }}>
            Delete and save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
