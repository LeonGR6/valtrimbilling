import { useState } from 'react'
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'

/**
 * A Package with a generated Release cannot be edited or deleted. This lists
 * those Releases and lets the user remove them first.
 */
export default function PackageReleasesNotice({ state, action }) {
  const { releases, loading, removingId, error, remove } = state
  const [confirmingId, setConfirmingId] = useState(null)

  if (loading) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">Checking Package documents…</Typography>
      </Stack>
    )
  }

  if (releases.length === 0 && !error) return null

  return (
    <Stack spacing={1}>
      {releases.length > 0 && (
        <Alert severity="warning">
          This Package has {releases.length === 1 ? 'a generated Release' : `${releases.length} generated Releases`}.
          {' '}Remove {releases.length === 1 ? 'it' : 'them'} first to {action}.
        </Alert>
      )}
      {releases.map(({ id, label, file }) => (
        <Stack
          key={id}
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', p: 1, border: 1, borderColor: 'divider', borderRadius: 1.5 }}
        >
          <PictureAsPdfRoundedIcon color="error" fontSize="small" />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
              {file.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
          </Box>
          {confirmingId === id ? (
            <>
              <Button size="small" color="inherit" onClick={() => setConfirmingId(null)}>
                Keep
              </Button>
              <Button
                size="small"
                color="error"
                variant="contained"
                disableElevation
                disabled={removingId === id}
                onClick={async () => {
                  await remove(id)
                  setConfirmingId(null)
                }}
              >
                {removingId === id ? 'Removing…' : 'Confirm remove'}
              </Button>
            </>
          ) : (
            <Button size="small" color="error" onClick={() => setConfirmingId(id)}>
              Remove Release
            </Button>
          )}
        </Stack>
      ))}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  )
}
