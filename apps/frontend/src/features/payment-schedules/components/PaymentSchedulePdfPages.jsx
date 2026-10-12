import { useEffect, useRef, useState } from 'react'
import { alpha, useTheme } from '@mui/material/styles'
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material'
import { Document, Page } from 'react-pdf'
import '../../release-templates/components/pdfWorker.js'
import {
  displayPageSize,
  rectToPixels,
} from '../../release-templates/services/releaseTemplateRecord.js'
import { drawLabel, formatMoney } from '../services/paymentScheduleRecord.js'

const MAX_PAGE_WIDTH = 820
const MIN_PAGE_WIDTH = 280
const GUTTER = 32

function PdfLoading({ children }) {
  return (
    <Stack spacing={1.25} sx={{ alignItems: 'center', py: 8 }}>
      <CircularProgress size={30} />
      <Typography variant="body2" color="text.secondary">{children}</Typography>
    </Stack>
  )
}

function CellBox({ cell, template, pixelSize, state, onSelect, boxRef }) {
  const theme = useTheme()
  const box = rectToPixels(cell.rect, pixelSize)
  const palette = {
    normal: { color: theme.palette.warning.main, fill: 0.3, width: 1 },
    lot: { color: theme.palette.info.main, fill: 0.35, width: 2 },
    selected: { color: theme.palette.primary.main, fill: 0.4, width: 3 },
    removed: { color: theme.palette.text.disabled, fill: 0, width: 1 },
  }[state]

  return (
    <Box
      ref={boxRef}
      role="button"
      tabIndex={0}
      title={`Lot ${cell.lot} · ${drawLabel(cell.draw, template)} · ${formatMoney(cell.amount)}`}
      aria-label={`Lot ${cell.lot}, ${drawLabel(cell.draw, template)}, ${formatMoney(cell.amount)}${state === 'removed' ? ', removed' : ''}`}
      aria-pressed={state === 'selected'}
      onClick={() => onSelect(cell.key)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(cell.key)
        }
      }}
      sx={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        boxSizing: 'border-box',
        border: `${palette.width}px ${state === 'removed' ? 'dashed' : 'solid'} ${palette.color}`,
        bgcolor: alpha(palette.color, palette.fill),
        // The highlight must not hide the text it sits on.
        mixBlendMode: state === 'removed' ? 'normal' : 'multiply',
        borderRadius: '2px',
        cursor: 'pointer',
        zIndex: state === 'selected' ? 3 : 2,
        '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
      }}
    />
  )
}

const SUMMARY_LABELS = {
  previouslyInvoiced: 'Previously Invoiced',
  thisRequest: 'This Request',
}

// The boxes a Package writes into: shown, not editable.
function SummaryBoxes({ summaryRows, page, pixelSize }) {
  const theme = useTheme()
  return Object.entries(SUMMARY_LABELS).flatMap(([key, label]) => (
    (summaryRows?.[key] ?? [])
      .filter((target) => target.page === page)
      .map((target) => {
        const box = rectToPixels(target.rect, pixelSize)
        return (
          <Box
            key={`${key}-${target.draw}`}
            title={`${label} · draw ${target.draw}`}
            sx={{
              position: 'absolute',
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              boxSizing: 'border-box',
              border: `1px dashed ${theme.palette.info.main}`,
              bgcolor: alpha(theme.palette.info.main, 0.12),
              pointerEvents: 'none',
            }}
          />
        )
      })
  ))
}

export default function PaymentSchedulePdfPages({
  file,
  template,
  cells,
  removedKeys,
  selectedKey,
  selectedLotId,
  summaryRows = null,
  onSelectCell,
}) {
  const containerRef = useRef(null)
  const selectedRef = useRef(null)
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

  // Choosing a cell or Lot in the side panel brings it into view on the PDF.
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [selectedKey, selectedLotId])

  const pageWidth = Math.round(
    Math.min(MAX_PAGE_WIDTH, Math.max(MIN_PAGE_WIDTH, containerWidth - GUTTER)),
  )
  const lotIdOf = (cell) => `${cell.phase ?? ''}|${cell.lot}`

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
        loading={<PdfLoading>Loading the PDF…</PdfLoading>}
        error={null}
        onLoadError={() => setLoadError(true)}
        onLoadSuccess={() => setLoadError(false)}
      >
        {template.pageSizes.map((pageSize) => {
          const display = displayPageSize(pageSize)
          const pageHeight = Math.round((pageWidth * display.height) / display.width)
          const pixelSize = { width: pageWidth, height: pageHeight }
          const pageCells = cells.filter((cell) => cell.page === pageSize.page)

          return (
            <Box key={pageSize.page} sx={{ mb: 3 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', textAlign: 'center', mb: 0.5 }}
              >
                Page {pageSize.page} of {template.pageSizes.length}
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
                  <SummaryBoxes
                    summaryRows={summaryRows}
                    page={pageSize.page}
                    pixelSize={pixelSize}
                  />
                  {pageCells.map((cell) => {
                    const state = removedKeys.has(cell.key)
                      ? 'removed'
                      : cell.key === selectedKey
                        ? 'selected'
                        : lotIdOf(cell) === selectedLotId ? 'lot' : 'normal'
                    const isAnchor = cell.key === selectedKey
                      || (selectedKey === null && lotIdOf(cell) === selectedLotId)
                    return (
                      <CellBox
                        key={cell.key}
                        cell={cell}
                        template={template}
                        pixelSize={pixelSize}
                        state={state}
                        onSelect={onSelectCell}
                        boxRef={isAnchor ? selectedRef : undefined}
                      />
                    )
                  })}
                </Box>
              </Box>
            </Box>
          )
        })}
      </Document>
    </Box>
  )
}
