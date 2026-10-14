import { useMemo } from 'react'
import { Box, Skeleton } from '@mui/material'
import { Document, Page } from 'react-pdf'
import '../../../release-templates/components/pdfWorker.js'

const WIDTH = 112

/**
 * The first page of a PDF, small, so a document can be told apart at a glance.
 * `onPages` gets the number of pages once the file is read.
 */
export default function DocumentThumbnail({ bytes, onPages }) {
  // pdf.js may take over the buffer it is given, so it gets its own copy.
  const file = useMemo(
    () => (bytes ? new Blob([bytes], { type: 'application/pdf' }) : null),
    [bytes],
  )

  return (
    <Box
      sx={{
        width: WIDTH,
        minHeight: Math.round(WIDTH * 1.29),
        flexShrink: 0,
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'common.white',
        boxShadow: 1,
      }}
    >
      {file ? (
        <Document
          file={file}
          suspense={false}
          loading={<Skeleton variant="rectangular" width={WIDTH} height={Math.round(WIDTH * 1.29)} />}
          error={null}
          onLoadSuccess={({ numPages }) => onPages?.(numPages)}
        >
          <Page
            suspense={false}
            pageNumber={1}
            width={WIDTH}
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        </Document>
      ) : (
        <Skeleton variant="rectangular" width={WIDTH} height={Math.round(WIDTH * 1.29)} />
      )}
    </Box>
  )
}
