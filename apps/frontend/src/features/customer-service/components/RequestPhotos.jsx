import { useEffect, useState } from 'react'
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material'
import { listRequestPhotos } from '../services/customerServicePhotosRepository.js'

// The photos that came in the customer's email (decided 25 Nov 2026): reduced copies the
// server keeps; the originals stay in Outlook. Selecting one opens it full size in a new
// tab. Nothing is shown when the email had no photos.
export default function RequestPhotos({ requestId }) {
  const [loaded, setLoaded] = useState({ requestId: null, photos: [], error: '' })
  useEffect(() => {
    let active = true
    listRequestPhotos(requestId)
      .then((photos) => { if (active) setLoaded({ requestId, photos, error: '' }) })
      .catch((error) => { if (active) setLoaded({ requestId, photos: [], error: error.message }) })
    return () => { active = false }
  }, [requestId])

  if (loaded.requestId !== requestId) {
    return (
      <Stack direction="row" spacing={1} role="status" sx={{ alignItems: 'center' }}>
        <CircularProgress size={16} />
        <Typography variant="caption" color="text.secondary">Loading photos from the email…</Typography>
      </Stack>
    )
  }
  if (loaded.error) return <Alert severity="warning" variant="outlined">{loaded.error}</Alert>
  if (!loaded.photos.length) return null

  return (
    <Box component="section" aria-label="Photos from the email">
      <Typography variant="subtitle2" fontWeight={800}>
        Photos from the email ({loaded.photos.length})
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
        Reduced copies. Select a photo to open it full size; the original stays in the email.
      </Typography>
      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {loaded.photos.map((photo, index) => (
          <Box key={photo.id} component="a" href={photo.url} target="_blank" rel="noreferrer"
            aria-label={`Open photo ${index + 1}, ${photo.name}, full size`}
            sx={{ display: 'block', borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider',
              '&:hover, &:focus-visible': { borderColor: 'primary.main' } }}>
            <Box component="img" src={photo.url} alt={`Photo ${index + 1} from the email: ${photo.name}`} loading="lazy"
              sx={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' }} />
          </Box>
        ))}
      </Box>
    </Box>
  )
}
