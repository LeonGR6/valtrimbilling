import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import { Document, Page } from 'react-pdf'
import '../../../release-templates/components/pdfWorker.js'
import { displayPageSize } from '../../../release-templates/services/releaseTemplateRecord.js'
import {
  DEFAULT_FIELD_FONT_SIZE,
  LINE_HEIGHT_EM,
  fitFieldFontSize,
} from '../../services/preliminaryNoticePdf.js'

const MAX_PAGE_WIDTH = 820
const MIN_PAGE_WIDTH = 280
const GUTTER = 32
const FONT_FAMILY = 'Helvetica, Arial, sans-serif'

let measuringContext = null
function textWidth(text, pixelSize) {
  measuringContext ??= globalThis.document?.createElement('canvas').getContext('2d') ?? null
  if (!measuringContext) return text.length * pixelSize * 0.55
  measuringContext.font = `${pixelSize}px ${FONT_FAMILY}`
  return measuringContext.measureText(text).width
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const FIELD_PADDING = 2
const FIELD_BACKGROUND = 'rgba(25, 118, 210, 0.08)'

// A printed blank: an input right on its line, so clicking and typing is all it takes.
function BlankField({ field, pixelSize, pointsPerPixel, value, onChange }) {
  const width = field.w * pixelSize.width
  const height = field.h * pixelSize.height
  const pagePoints = pixelSize.width * pointsPerPixel
  const size = fitFieldFontSize({
    size: DEFAULT_FIELD_FONT_SIZE,
    textWidth: textWidth(value, DEFAULT_FIELD_FONT_SIZE),
    maxWidth: field.w * pagePoints - FIELD_PADDING * 2,
  })

  return (
    <input
      value={value}
      aria-label={field.label}
      title={field.label}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => onChange(field.id, event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        position: 'absolute',
        left: field.x * pixelSize.width,
        top: field.y * pixelSize.height,
        width,
        height,
        boxSizing: 'border-box',
        margin: 0,
        padding: `0 ${FIELD_PADDING / pointsPerPixel}px`,
        border: 0,
        borderRadius: 2,
        outlineOffset: 0,
        background: FIELD_BACKGROUND,
        color: '#000',
        fontFamily: FONT_FAMILY,
        fontSize: `${size / pointsPerPixel}px`,
        lineHeight: `${height}px`,
      }}
    />
  )
}

// A printed square: a click puts an X in it or takes it out.
function CheckField({ field, pixelSize, checked, onChange }) {
  const width = field.w * pixelSize.width
  const height = field.h * pixelSize.height
  const toggle = () => onChange(field.id, !checked)

  return (
    <Box
      role="checkbox"
      tabIndex={0}
      aria-checked={checked}
      aria-label={field.label}
      title={field.label}
      onPointerDown={(event) => {
        event.stopPropagation()
        toggle()
      }}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          toggle()
        }
      }}
      sx={{
        position: 'absolute',
        left: field.x * pixelSize.width,
        top: field.y * pixelSize.height,
        width,
        height,
        bgcolor: FIELD_BACKGROUND,
        cursor: 'pointer',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
        '&:hover': { bgcolor: 'rgba(25, 118, 210, 0.2)' },
      }}
    >
      {checked && (
        <svg
          viewBox="0 0 10 10"
          width="100%"
          height="100%"
          style={{ display: 'block' }}
          aria-hidden="true"
        >
          <path d="M1.5 1.5 L8.5 8.5 M1.5 8.5 L8.5 1.5" stroke="#000" strokeWidth="1.3" fill="none" />
        </svg>
      )}
    </Box>
  )
}

function TextEntry({
  entry,
  pixelSize,
  pointsPerPixel,
  selected,
  autoFocus,
  onSelect,
  onChange,
  onBlurEmpty,
}) {
  const inputRef = useRef(null)
  const drag = useRef(null)
  const fontPixels = entry.fontSize / pointsPerPixel
  const heightPixels = fontPixels * LINE_HEIGHT_EM
  const widthPixels = Math.max(textWidth(entry.text, fontPixels) + fontPixels, fontPixels * 4)

  useEffect(() => {
    if (!autoFocus) return undefined
    // After the click that placed the text has finished moving the focus.
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [autoFocus])

  const startDrag = (event) => {
    event.preventDefault()
    onSelect(entry.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      x: entry.x,
      y: entry.y,
    }
  }

  const moveDrag = (event) => {
    const start = drag.current
    if (!start) return
    onChange(entry.id, {
      x: clamp(
        start.x + (event.clientX - start.startX) / pixelSize.width,
        0,
        Math.max(0, 1 - widthPixels / pixelSize.width),
      ),
      y: clamp(
        start.y + (event.clientY - start.startY) / pixelSize.height,
        0,
        Math.max(0, 1 - heightPixels / pixelSize.height),
      ),
    })
  }

  const endDrag = (event) => {
    drag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        left: entry.x * pixelSize.width,
        top: entry.y * pixelSize.height,
        height: heightPixels,
        width: widthPixels,
        zIndex: selected ? 3 : 2,
        outline: selected ? '2px solid' : '1px dashed',
        outlineColor: selected ? 'primary.main' : 'primary.light',
        borderRadius: '2px',
        bgcolor: selected ? 'rgba(25, 118, 210, 0.08)' : 'transparent',
        '&:hover .notice-grip': { opacity: 1 },
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Box
        className="notice-grip"
        role="button"
        aria-label="Move this text"
        title="Drag to move"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        sx={{
          position: 'absolute',
          right: '100%',
          top: 0,
          height: '100%',
          minHeight: 18,
          width: 18,
          display: 'grid',
          placeItems: 'center',
          cursor: 'grab',
          touchAction: 'none',
          color: 'common.white',
          bgcolor: 'primary.main',
          borderRadius: '3px 0 0 3px',
          opacity: selected ? 1 : 0,
        }}
      >
        <DragIndicatorRoundedIcon sx={{ fontSize: 16 }} />
      </Box>
      <input
        ref={inputRef}
        value={entry.text}
        aria-label="Text on the Preliminary Notice"
        spellCheck={false}
        autoComplete="off"
        onFocus={() => onSelect(entry.id)}
        onChange={(event) => onChange(entry.id, { text: event.target.value })}
        onBlur={() => onBlurEmpty(entry.id)}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          margin: 0,
          padding: 0,
          border: 0,
          outline: 0,
          background: 'transparent',
          color: '#000',
          fontFamily: FONT_FAMILY,
          fontSize: `${fontPixels}px`,
          lineHeight: LINE_HEIGHT_EM,
        }}
      />
    </Box>
  )
}

/**
 * The pages of a PDF with the texts typed on them. With `adding` on, a click on
 * a page puts a new text there.
 */
export default function PreliminaryNoticePages({
  data,
  pageSizes,
  entries,
  selectedId,
  adding,
  focusId,
  fields = [],
  fieldValues = {},
  onSelect,
  onAdd,
  onChange,
  onFieldChange,
  onBlurEmpty,
}) {
  const containerRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(MAX_PAGE_WIDTH + GUTTER)
  const [loadError, setLoadError] = useState(false)
  // pdf.js may detach the buffer it receives, so it gets a copy.
  const file = useMemo(() => ({ data: data.slice() }), [data])

  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(([item]) => setContainerWidth(item.contentRect.width))
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
      <Document
        file={file}
        suspense={false}
        loading={(
          <Stack spacing={1.25} sx={{ alignItems: 'center', py: 8 }}>
            <CircularProgress size={30} />
            <Typography variant="body2" color="text.secondary">Loading the PDF…</Typography>
          </Stack>
        )}
        error={null}
        onLoadError={() => setLoadError(true)}
        onLoadSuccess={() => setLoadError(false)}
      >
        {pageSizes.map((pageSize) => {
          const display = displayPageSize(pageSize)
          const pageHeight = Math.round((pageWidth * display.height) / display.width)
          const pixelSize = { width: pageWidth, height: pageHeight }
          const pointsPerPixel = display.width / pageWidth

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
                data-page={pageSize.page}
                onPointerDown={(event) => {
                  if (!adding) {
                    onSelect(null)
                    return
                  }
                  const bounds = event.currentTarget.getBoundingClientRect()
                  onAdd({
                    page: pageSize.page,
                    x: clamp((event.clientX - bounds.left) / pageWidth, 0, 0.95),
                    y: clamp((event.clientY - bounds.top) / pageHeight, 0, 0.98),
                    pixelSize,
                    pointsPerPixel,
                  })
                }}
                sx={{
                  position: 'relative',
                  width: pageWidth,
                  height: pageHeight,
                  mx: 'auto',
                  bgcolor: 'common.white',
                  boxShadow: 3,
                  cursor: adding ? 'crosshair' : 'default',
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
                <Box sx={{ position: 'absolute', inset: 0, pointerEvents: adding ? 'none' : 'auto' }}>
                  {fields
                    .filter((field) => field.page === pageSize.page)
                    .map((field) => (field.kind === 'check' ? (
                      <CheckField
                        key={field.id}
                        field={field}
                        pixelSize={pixelSize}
                        checked={fieldValues[field.id] === true}
                        onChange={onFieldChange}
                      />
                    ) : (
                      <BlankField
                        key={field.id}
                        field={field}
                        pixelSize={pixelSize}
                        pointsPerPixel={pointsPerPixel}
                        value={fieldValues[field.id] ?? ''}
                        onChange={onFieldChange}
                      />
                    )))}
                  {entries
                    .filter((entry) => entry.page === pageSize.page)
                    .map((entry) => (
                      <TextEntry
                        key={entry.id}
                        entry={entry}
                        pixelSize={pixelSize}
                        pointsPerPixel={pointsPerPixel}
                        selected={selectedId === entry.id}
                        autoFocus={focusId === entry.id}
                        onSelect={onSelect}
                        onChange={onChange}
                        onBlurEmpty={onBlurEmpty}
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
