import { useEffect, useRef, useState } from 'react'
import { Box, Paper, Typography, useMediaQuery } from '@mui/material'

// The width the email is laid out at before it is scaled: its 600 px card and side margins,
// wide enough that the template's phone layout (600 px or less) does not kick in.
const EMAIL_WIDTH = 640
// Until the email has loaded and been measured.
const FALLBACK_HEIGHT = 900

// The whole customer email in the same HTML the server sends, with its subject. It is shown
// whole, without a scroll of its own: scaled down to the width it has and, with fill (from md
// up), also to the height of its parent (a dialog column).
export default function CustomerEmailPreview({ preview, fill = false }) {
  const fillsHeight = useMediaQuery((theme) => theme.breakpoints.up('md')) && fill
  const area = useRef(null)
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 })
  const [emailHeight, setEmailHeight] = useState(0)

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setAreaSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(area.current)
    return () => observer.disconnect()
  }, [])

  const height = emailHeight || FALLBACK_HEIGHT
  const scale = Math.min(1, areaSize.width / EMAIL_WIDTH, fillsHeight ? areaSize.height / height : 1)

  return (
    <Paper variant="outlined" sx={{
      overflow: 'hidden', display: 'flex', flexDirection: 'column', ...(fillsHeight && { height: '100%' }),
    }}>
      <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" component="div">Preview · as the customer sees it</Typography>
        <Typography variant="body2" fontWeight={700} sx={{ mt: 0.5 }}>{preview.subject}</Typography>
      </Box>
      <Box ref={area} sx={{ p: 1.5, minHeight: 0, overflow: 'hidden', ...(fillsHeight && { flex: '1 1 auto' }) }}>
        <Box sx={{
          width: EMAIL_WIDTH * scale, height: height * scale, mx: 'auto', overflow: 'hidden',
          borderRadius: 1, visibility: areaSize.width ? 'visible' : 'hidden',
        }}>
          {/* allow-same-origin only lets the dialog measure the email's height; without
              allow-scripts the email runs nothing. */}
          <Box component="iframe" title="Email preview" sandbox="allow-same-origin" scrolling="no" srcDoc={preview.html}
            onLoad={(event) => setEmailHeight(event.currentTarget.contentDocument?.body?.scrollHeight ?? 0)}
            sx={{
              display: 'block', border: 0, width: EMAIL_WIDTH, height,
              transform: `scale(${scale})`, transformOrigin: '0 0',
            }} />
        </Box>
      </Box>
    </Paper>
  )
}
