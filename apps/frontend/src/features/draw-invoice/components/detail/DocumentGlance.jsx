import { Box, Stack, Typography } from '@mui/material'
import { formatFileSize } from '../documents/jobDocumentTypes.js'
import DocumentThumbnail from './DocumentThumbnail.jsx'

/** The thumbnail of a document with its page count and size. */
export default function DocumentGlance({ bytes, pages, onPages, caption }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}>
      <DocumentThumbnail bytes={bytes} onPages={onPages} />
      <Box>
        <Typography variant="body2" fontWeight={750}>
          {bytes
            ? [
                pages ? `${pages} ${pages === 1 ? 'page' : 'pages'}` : null,
                formatFileSize(bytes.length),
              ].filter(Boolean).join(' · ')
            : 'Preparing preview…'}
        </Typography>
        {caption && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {caption}
          </Typography>
        )}
      </Box>
    </Stack>
  )
}
