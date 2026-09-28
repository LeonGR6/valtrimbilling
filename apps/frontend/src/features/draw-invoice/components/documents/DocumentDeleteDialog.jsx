import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'

export default function DocumentDeleteDialog({
  target,
  deleting,
  error,
  onClose,
  onDelete,
}) {
  const jobCode = target.job.code ?? target.job.id

  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={deleting ? undefined : onClose}
      aria-labelledby="delete-job-document-title"
    >
      <DialogTitle id="delete-job-document-title">Delete PDF?</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography color="text.secondary">
            <strong>{target.document.name}</strong> will be permanently deleted from
            {' '}Job #{jobCode}. This action cannot be undone.
          </Typography>

          {target.isOnlyRequiredDocument && (
            <Alert severity="warning">
              This is the only uploaded {target.type.singularLabel.toLowerCase()}.
              Deleting it will mark this required document as missing.
            </Alert>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          startIcon={<DeleteOutlineRoundedIcon />}
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? 'Deleting…' : 'Delete PDF'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
