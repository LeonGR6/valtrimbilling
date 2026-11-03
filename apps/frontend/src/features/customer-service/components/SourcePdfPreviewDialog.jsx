import { useCallback, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  useMediaQuery,
} from '@mui/material'
import { getCustomerServiceSourcePdfUrls } from '../services/customerServiceSourcePdf.js'
import OriginalEmailSource from './OriginalEmailSource.jsx'
import SourceFilePreview, { SessionSourceFilePreview } from './SourceFilePreview.jsx'

function ReferenceText({ children }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 2,
        maxHeight: '60vh',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontSize: '0.8125rem',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
      }}
    >
      {children}
    </Box>
  )
}

export default function SourcePdfPreviewDialog({ request, onClose, canRetryPdf = false, onRetryPdf }) {
  const fullScreen = useMediaQuery((theme) => theme.breakpoints.down('sm'))
  const [activeTab, setActiveTab] = useState('ORIGINAL')
  const sourceDocument = request.sourceDocument
  const storedPdf = sourceDocument?.storage
  const extraction = sourceDocument?.extraction
  const file = sourceDocument?.file instanceof Blob ? sourceDocument.file : null
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const emailText = request.sourceEmail?.body ?? ''
  const attachmentNames = request.sourceEmail?.attachmentNames ?? []
  const hasAttachments = attachmentNames.length > 0 || Number(request.sourceEmail?.attachmentCount) > 0
  const textSource = Boolean(request.emailImportId) || sourceDocument?.sourceType === 'EMAIL_TEXT'
    || (!sourceDocument?.sourceType && !file && Boolean(emailText))
  const recoveryPdf = Boolean(request.emailImportId && sourceDocument?.sourceType === 'PDF')
  const pdfPending = sourceDocument?.sourceType === 'PDF' && !storedPdf
  const loadPdfUrls = useCallback(() => getCustomerServiceSourcePdfUrls(storedPdf?.requestId), [storedPdf?.requestId])
  const pdfContent = storedPdf?.requestId
    ? <SourceFilePreview key={`${storedPdf.requestId}-${storedPdf.fileId}`} loadUrls={loadPdfUrls} fallbackFile={file} />
    : file ? <SessionSourceFilePreview file={file} />
      : <Alert severity="warning">The original PDF is not available. {sourceDocument?.fileError}</Alert>

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={fullScreen}
      maxWidth="lg"
      aria-labelledby="source-pdf-preview-title"
    >
      <DialogTitle id="source-pdf-preview-title">
        Source & extraction · {request.requestNumber}
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'background.default', minWidth: 0, overflowWrap: 'anywhere' }}>
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          {request.emailImportId
            ? 'Email reference and extracted information are retained with this request. New email image files are not stored. Manual form corrections do not change the source extraction.'
            : sourceDocument?.persisted || request.prototypeOnly === false || storedPdf
            ? 'The original source and extraction are retained with the request. Manual form corrections do not change this reference.'
            : 'Frontend simulation: this source is available only in memory and resets when the page reloads. Manual form corrections do not change this reference.'}
        </Alert>
        {pdfPending && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 2 }} action={canRetryPdf && (
            <Button color="inherit" disabled={retrying} onClick={async () => {
              setRetrying(true)
              setRetryError('')
              try { await onRetryPdf() } catch (error) { setRetryError(error.message) }
              finally { setRetrying(false) }
            }}>{retrying ? 'Retrying…' : 'Retry PDF'}</Button>
          )}>
            {request.requestNumber} is saved, but its original PDF is not available.
            {' '}{retryError || sourceDocument.fileError}
            {!canRetryPdf && ' The original file is no longer available for retry in this session. Email text and retained extraction can still be reviewed.'}
          </Alert>
        )}
        <Tabs
          value={activeTab}
          onChange={(_, value) => setActiveTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Source document and extraction"
          sx={{ mb: 2 }}
        >
          <Tab id="source-tab-original" aria-controls="source-panel-original" value="ORIGINAL" label={textSource ? 'Original email' : 'Original PDF'} />
          {recoveryPdf && <Tab id="source-tab-recovery" aria-controls="source-panel-recovery" value="RECOVERY" label="Recovery PDF" />}
          <Tab id="source-tab-text" aria-controls="source-panel-text" value="TEXT" label={recoveryPdf ? 'Recovery OCR text' : textSource ? 'Analyzed text' : 'OCR text'} disabled={!extraction} />
          <Tab id="source-tab-json" aria-controls="source-panel-json" value="JSON" label={recoveryPdf ? 'Recovery JSON' : 'JSON'} disabled={!extraction} />
        </Tabs>
        <Box role="tabpanel" id="source-panel-original" aria-labelledby="source-tab-original" hidden={activeTab !== 'ORIGINAL'}>
          {activeTab === 'ORIGINAL' && (textSource ? (
            <Stack spacing={2}>
              {!request.emailImportId && hasAttachments && <Alert severity="warning">Only attachment metadata is available: {attachmentNames.join(', ') || 'Original attachment'}.</Alert>}
              <OriginalEmailSource request={request} />
            </Stack>
          ) : storedPdf || file || pdfPending ? pdfContent : (
            <Alert severity="warning" variant="outlined">
              {hasAttachments
                ? `Only attachment metadata is available for this request: ${attachmentNames.join(', ') || 'Original attachment'}.`
                : 'This request was created manually without a PDF or email text.'}
              {' '}A source is optional and cannot be uploaded while editing.
            </Alert>
          ))}
          {!extraction && !request.emailImportId && (storedPdf || file || textSource) && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>
              No successful AI extraction was retained for this source. The original source can still be reviewed.
            </Alert>
          )}
        </Box>
        {recoveryPdf && <Box role="tabpanel" id="source-panel-recovery" aria-labelledby="source-tab-recovery" hidden={activeTab !== 'RECOVERY'}>
          {activeTab === 'RECOVERY' && <Stack spacing={2}>
            <Alert severity="info">This PDF was supplied during manual recovery. It does not replace the original email or its attachments.</Alert>
            {pdfContent}
          </Stack>}
        </Box>}
        <Box role="tabpanel" id="source-panel-text" aria-labelledby="source-tab-text" hidden={activeTab !== 'TEXT'}>
          <ReferenceText>{extraction?.text || (request.emailImportId && !recoveryPdf
            ? 'Review the Original email tab for the email body and each attachment’s extracted text.'
            : 'No extracted text is available.')}</ReferenceText>
        </Box>
        <Box role="tabpanel" id="source-panel-json" aria-labelledby="source-tab-json" hidden={activeTab !== 'JSON'}>
          <ReferenceText>{extraction ? JSON.stringify(extraction.structuredData, null, 2) : 'No structured data is available.'}</ReferenceText>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
