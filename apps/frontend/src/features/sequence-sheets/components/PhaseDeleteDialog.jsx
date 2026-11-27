import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { formatPhaseBuilding } from '../utils/phaseBuildingCodes.js'
import { getPhaseRowCounts, getSelectedOptionCount } from '../utils/phaseCounts.js'

export default function PhaseDeleteDialog({ busy, target, onClose, onDelete }) {
  const rowCounts = getPhaseRowCounts(target?.phase)
  const selectedOptionCount = getSelectedOptionCount(target?.phase)

  return (
    <Dialog
      open={Boolean(target)}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>
        Delete {target ? formatPhaseBuilding(target.phase.name, target.phase.building) : 'phase'}?
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Alert severity="warning">
            This will remove this Phase from the active Sequence Sheet, including {rowCounts.lots}{' '}
            {rowCounts.lots === 1 ? 'lot assignment' : 'lot assignments'}
            {rowCounts.utility > 0
              ? ` and ${rowCounts.utility} Utility ${rowCounts.utility === 1 ? 'row' : 'rows'}`
              : ''}
            {selectedOptionCount > 0
              ? `, including ${selectedOptionCount} selected ${selectedOptionCount === 1 ? 'option' : 'options'}`
              : ''}. Cancelled Calendar history will remain archived for audit.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            The Job Total Lots will be recalculated from ordinary Lots only;
            Utility rows never affect that count.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          onClick={onDelete}
          disableElevation
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {busy ? 'Deleting…' : 'Delete phase'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
