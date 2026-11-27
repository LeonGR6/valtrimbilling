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
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { plural } from '../../../utils/plural.js'

/**
 * Stays at the top while prices are being edited: how many changed, what still
 * needs fixing, and the two ways out. Saving or discarding locks the sheet again.
 */
export default function PriceWorksheetBar({
  changeCount, errorCount, saving, onSave, onDiscard,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const hasChanges = changeCount > 0

  const cancel = () => {
    if (hasChanges) setConfirmOpen(true)
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
            <Typography sx={{ fontWeight: 600 }}>Editing prices</Typography>
            <Typography variant="body2" color="text.secondary">
              {hasChanges ? plural(changeCount, 'change') : 'No changes yet'}
            </Typography>
            {errorCount > 0 && (
              <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 600 }}>
                {plural(errorCount, 'price')} to fix
              </Typography>
            )}
          </Box>
          <Typography variant="caption" color="text.secondary">
            Enter or the arrow keys move to the next price. You can paste a column from a spreadsheet.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button color="inherit" onClick={cancel} disabled={saving} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveRoundedIcon />}
            onClick={onSave}
            disabled={!hasChanges || saving}
            disableElevation
            sx={{ textTransform: 'none' }}
          >
            {saving ? 'Saving…' : hasChanges ? `Save ${plural(changeCount, 'change')}` : 'Save changes'}
          </Button>
        </Box>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Discard your changes?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {plural(changeCount, 'price')} you changed will go back to what is saved.
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
            Discard changes
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
