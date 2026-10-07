import { useEffect, useRef, useState } from 'react'
import { alpha, useTheme } from '@mui/material/styles'
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material'
import { Document, Page } from 'react-pdf'
import { Rnd } from 'react-rnd'
import './pdfWorker.js'
import {
  displayPageSize,
  getReleaseVariable,
  pixelsToRect,
  rectToPixels,
  sampleValue,
} from '../services/releaseTemplateRecord.js'

const MAX_PAGE_WIDTH = 820
const MIN_PAGE_WIDTH = 280
const GUTTER = 32
const MIN_BOX_WIDTH = 28
const MIN_BOX_HEIGHT = 12

const VARIABLE_COLOR = {
  through_date: 'primary',
  check_amount: 'success',
  signature_date: 'warning',
}

function PdfLoading({ children }) {
  return (
    <Stack spacing={1.25} sx={{ alignItems: 'center', py: 8 }}>
      <CircularProgress size={30} />
      <Typography variant="body2" color="text.secondary">{children}</Typography>
    </Stack>
  )
}

function PlacementBox({
  placement,
  pageSize,
  pixelSize,
  pointsPerPixel,
  selected,
  readOnly,
  color,
  onSelect,
  onChange,
}) {
  const variable = getReleaseVariable(placement.variable)
  const box = rectToPixels(placement, pixelSize)
  const commit = (next) => onChange(placement.variable, pixelsToRect(next, pixelSize))

  return (
    <Rnd
      bounds="parent"
      size={{ width: box.width, height: box.height }}
      position={{ x: box.x, y: box.y }}
      minWidth={MIN_BOX_WIDTH}
      minHeight={MIN_BOX_HEIGHT}
      disableDragging={readOnly}
      enableResizing={!readOnly}
      onMouseDown={() => onSelect(placement.variable)}
      onDragStop={(_event, data) => commit({
        x: data.x,
        y: data.y,
        width: box.width,
        height: box.height,
      })}
      onResizeStop={(_event, _direction, element, _delta, position) => commit({
        x: position.x,
        y: position.y,
        width: element.offsetWidth,
        height: element.offsetHeight,
      })}
      style={{
        boxSizing: 'border-box',
        border: `${selected ? 3 : 2}px solid ${color}`,
        background: alpha(color, selected ? 0.22 : 0.12),
        borderRadius: 3,
        zIndex: selected ? 3 : 2,
        cursor: readOnly ? 'default' : 'move',
      }}
      aria-label={`${variable?.label ?? placement.variable} box on page ${pageSize.page}`}
    >
      <Box
        sx={{
          position: 'absolute',
          bottom: '100%',
          left: -2,
          px: 0.75,
          py: 0.1,
          borderRadius: '4px 4px 0 0',
          bgcolor: color,
          color: 'common.white',
          fontSize: 11,
          fontWeight: 700,
          lineHeight: '16px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {variable?.label ?? placement.variable}
      </Box>
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          px: 0.5,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          color: 'text.primary',
          fontFamily: 'Helvetica, Arial, sans-serif',
          lineHeight: 1,
          pointerEvents: 'none',
          // The text is drawn at the size it will have on the page.
          fontSize: `${Number(placement.fontSize) / pointsPerPixel}px`,
        }}
      >
        {sampleValue(placement.variable, placement.format)}
      </Box>
    </Rnd>
  )
}

export default function ReleasePdfPages({
  file,
  pageSizes,
  placements,
  selectedVariable,
  readOnly,
  onSelect,
  onChange,
}) {
  const theme = useTheme()
  const containerRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(MAX_PAGE_WIDTH + GUTTER)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const pageWidth = Math.round(
    Math.min(MAX_PAGE_WIDTH, Math.max(MIN_PAGE_WIDTH, containerWidth - GUTTER)),
  )

  return (
    <Box ref={containerRef} sx={{ width: '100%', minWidth: 0 }}>
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          The PDF could not be displayed. Close this window and try again.
        </Alert>
      )}
      {/* react-pdf suspends by default. Loading is handled here with its own
          loading and error states, so nothing above this component is hidden
          while a PDF or a page is being read. */}
      <Document
        file={file}
        suspense={false}
        loading={<PdfLoading>Loading the PDF…</PdfLoading>}
        error={null}
        onLoadError={() => setLoadError(true)}
        onLoadSuccess={() => setLoadError(false)}
      >
        {pageSizes.map((pageSize) => {
          const display = displayPageSize(pageSize)
          const pageHeight = Math.round((pageWidth * display.height) / display.width)
          const pixelSize = { width: pageWidth, height: pageHeight }

          return (
            <Box key={pageSize.page} sx={{ mb: 3 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', textAlign: 'center', mb: 0.5 }}
              >
                Page {pageSize.page} of {pageSizes.length}
              </Typography>
              <Box
                sx={{
                  position: 'relative',
                  width: pageWidth,
                  height: pageHeight,
                  mx: 'auto',
                  bgcolor: 'common.white',
                  boxShadow: 3,
                }}
              >
                <Page
                  suspense={false}
                  pageNumber={pageSize.page}
                  width={pageWidth}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  loading={<Box sx={{ width: pageWidth, height: pageHeight }} />}
                />
                <Box sx={{ position: 'absolute', inset: 0 }}>
                  {placements
                    .filter((placement) => (
                      placement.kind === 'rect' && placement.page === pageSize.page
                    ))
                    .map((placement) => (
                      <PlacementBox
                        key={placement.variable}
                        placement={placement}
                        pageSize={pageSize}
                        pixelSize={pixelSize}
                        pointsPerPixel={display.width / pageWidth}
                        selected={selectedVariable === placement.variable}
                        readOnly={readOnly}
                        color={theme.palette[VARIABLE_COLOR[placement.variable] ?? 'primary'].main}
                        onSelect={onSelect}
                        onChange={onChange}
                      />
                    ))}
                </Box>
              </Box>
            </Box>
          )
        })}
      </Document>
    </Box>
  )
}
