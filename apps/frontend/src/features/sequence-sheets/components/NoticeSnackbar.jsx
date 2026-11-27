import { Alert, Snackbar } from '@mui/material'

export default function NoticeSnackbar({ notice, onClose }) {
  return (
    <Snackbar
      open={Boolean(notice)}
      autoHideDuration={4000}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {notice ? (
        <Alert severity={notice.severity} onClose={onClose} variant="filled">
          {notice.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  )
}
