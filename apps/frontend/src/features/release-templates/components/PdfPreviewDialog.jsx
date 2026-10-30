import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import { Document, Page } from 'react-pdf'
import './pdfWorker.js'

const MAX_PAGE_WIDTH = 900
const MIN_PAGE_WIDTH = 280
const GUTTER = 32

/**
 * Shows a PDF that has only been built, not saved: how a document will look
 * before it is generated. With `onConfirm` the person can go ahead from here.
 */
export default function PdfPreviewDialog({
  title,
  subtitle = null,
  bytes,
  confirmLabel = null,
  onConfirm = null,
  // What to tell about the file; the default is for one that was only built.
  statusNote = 'nothing has been saved yet',
  // Adds a Download button, for a file the person may want to keep.
  onDownload = null,
  onClose,
}) {
  const containerRef = useRef(null)
  const [width, setWidth] = useState(MAX_PAGE_WIDTH)
  const [pageCount, setPageCount] = useState(0)
  const [loadError, setLoadError] = useState(false)
  // pdf.js may take over the buffer it is given, so it gets its own copy.
  const file = useMemo(() => new Blob([bytes], { type: 'application/pdf' }), [bytes])

  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const pageWidth = Math.round(Math.min(MAX_PAGE_WIDTH, Math.max(MIN_PAGE_WIDTH, width - GUTTER)))

  return (
    <Dialog open fullScreen onClose={onClose} aria-labelledby="pdf-preview-title">
      <DialogTitle
        id="pdf-preview-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 1.5 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="span" variant="h6" fontWeight={850} sx={{ display: 'block' }}>
            {title}
          </Typography>
          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            noWrap
            sx={{ display: 'block' }}
          >
            Preview{subtitle ? ` · ${subtitle}` : ''}{statusNote ? ` · ${statusNote}` : ''}
          </Typography>
        </Box>
        <IconButton aria-label="Close preview" onClick={onClose}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0, bgcolor: 'action.hover' }}>
        <Box ref={containerRef} sx={{ p: { xs: 1.5, sm: 2.5 }, minWidth: 0 }}>
          {loadError && (
            <Alert severity="error" sx={{ mb: 2 }}>The preview could not be displayed.</Alert>
          )}
          <Document
            file={file}
            suspense={false}
            loading={(
              <Stack spacing={1.25} sx={{ alignItems: 'center', py: 8 }}>
                <CircularProgress size={30} />
                <Typography variant="body2" color="text.secondary">Loading the preview…</Typography>
              </Stack>
            )}
            error={null}
            onLoadError={() => setLoadError(true)}
            onLoadSuccess={({ numPages }) => {
              setPageCount(numPages)
              setLoadError(false)
            }}
          >
            {Array.from({ length: pageCount }, (_, index) => (
              <Box key={index + 1} sx={{ mb: 3 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', textAlign: 'center', mb: 0.5 }}
                >
                  Page {index + 1} of {pageCount}
                </Typography>
                <Box sx={{ width: pageWidth, mx: 'auto', bgcolor: 'common.white', boxShadow: 3 }}>
                  <Page
                    suspense={false}
                    pageNumber={index + 1}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                    loading={<Box sx={{ width: pageWidth, height: Math.round(pageWidth * 1.3) }} />}
                  />
                </Box>
              </Box>
            ))}
          </Document>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose}>Close</Button>
        {onDownload && (
          <Button variant={onConfirm ? 'text' : 'contained'} disableElevation startIcon={<DownloadRoundedIcon />} onClick={onDownload}>
            Download
          </Button>
        )}
        {onConfirm && (
          <Button variant="contained" onClick={onConfirm}>{confirmLabel}</Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
