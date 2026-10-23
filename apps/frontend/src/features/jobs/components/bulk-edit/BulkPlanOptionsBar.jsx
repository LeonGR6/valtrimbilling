import { useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { describeBulkSummary } from '../../utils/bulkPlanOptions.js'

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/**
 * Stays at the top while Plans and Options are being edited: what saving would do, what still needs
 * fixing, what is ticked for deletion, and the two ways out.
 */
export default function BulkPlanOptionsBar({
  summary, canSave, hasContent, saving, selectedCount, onDeleteSelected, onClearSelection, onSave, onDiscard,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  const cancel = () => {
    if (hasContent) setConfirmOpen(true)
    else onDiscard()
  }

  return (
    <>
      <Box
        sx={{
          position: 'sticky',
          top: 8,
          zIndex: 3,
          mb: 2,
          px: 2,
          py: 1.25,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          border: 1,
          borderColor: 'primary.main',
          borderRadius: 2,
          bgcolor: 'background.paper',
          boxShadow: 3,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }} aria-live="polite">
            <Typography sx={{ fontWeight: 600 }}>Editing plans &amp; options</Typography>
            <Typography variant="body2" color="text.secondary">
              {describeBulkSummary(summary)}
            </Typography>
            {summary.optionsSkipped > 0 && (
              <Typography variant="body2" color="text.secondary">
                {plural(summary.optionsSkipped, 'option')} already there
              </Typography>
            )}
            {summary.errorCount > 0 && (
              <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 600 }}>
                {plural(summary.errorCount, 'row')} to fix
              </Typography>
            )}
          </Box>
          <Typography variant="caption" color="text.secondary">
            Edit any cell, tick rows to delete them, or paste new rows at the bottom. Enter moves down.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {selectedCount > 0 && (
            <>
              <Typography variant="body2" color="text.secondary">{selectedCount} selected</Typography>
              <Button
                color="error"
                variant="outlined"
                size="small"
                startIcon={<DeleteOutlineRoundedIcon />}
                onClick={onDeleteSelected}
                sx={{ textTransform: 'none' }}
              >
                Delete selected
              </Button>
              <Button color="inherit" size="small" onClick={onClearSelection} sx={{ textTransform: 'none' }}>
                Clear
              </Button>
            </>
          )}
          <Button color="inherit" onClick={cancel} disabled={saving} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveRoundedIcon />}
            onClick={onSave}
            disabled={!canSave || saving}
            disableElevation
            sx={{ textTransform: 'none' }}
          >
            {saving ? 'Saving…' : 'Save all'}
          </Button>
        </Box>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Discard your changes?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Nothing has been saved yet. If you leave now, what you edited, marked for deletion or typed is lost.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setConfirmOpen(false)} sx={{ textTransform: 'none' }}>
            Keep editing
          </Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            sx={{ textTransform: 'none' }}
            onClick={() => {
              setConfirmOpen(false)
              onDiscard()
            }}
          >
            Discard
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
