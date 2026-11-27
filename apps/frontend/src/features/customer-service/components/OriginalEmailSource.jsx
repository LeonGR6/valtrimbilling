import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import { requireSupabase } from '../../../services/api.js'
import { canOpenImportSource, createCustomerServiceImportSourceRepository } from '../services/customerServiceImportSourceRepository.js'
import { safeEmailWebLink } from '../services/customerServiceEmailImportRepository.js'
import { customerServiceTimeZone } from '../utils/dates.js'
import SourceFilePreview from './SourceFilePreview.jsx'
import ImportAttachmentAnalysis from './ImportAttachmentAnalysis.jsx'

const repository = createCustomerServiceImportSourceRepository({ getClient: requireSupabase })

function readableEmail(body, format) {
  if (format !== 'HTML') return body
  // Template content is inert and NEVER inserted into the document. Only its
  // text is rendered by React: no scripts, remote images or links are activated.
  const template = document.createElement('template')
  template.innerHTML = body
  template.content.querySelectorAll('script,style,noscript,template,iframe,object,embed,svg,math,head').forEach((node) => node.remove())
  template.content.querySelectorAll('br').forEach((node) => node.replaceWith('\n'))
  template.content.querySelectorAll('p,div,tr,li,table,h1,h2,h3,h4,h5,h6,blockquote').forEach((node) => node.append('\n'))
  template.content.querySelectorAll('td,th').forEach((node) => node.append('\t'))
  return template.content.textContent.replaceAll('\u00a0', ' ').replace(/\n[\t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function emailDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not available'
  return new Intl.DateTimeFormat('en-US', { timeZone: customerServiceTimeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function fileSize(bytes) {
  const [value, unit] = bytes < 1000 ? [bytes, 'bytes'] : bytes < 1000000 ? [bytes / 1000, 'KB'] : [bytes / 1000000, 'MB']
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)} ${unit}`
}

function OutlookLink({ webLink }) {
  if (!webLink) return null
  return <Button component="a" href={webLink} target="_blank" rel="noopener noreferrer"
    size="small" variant="outlined" startIcon={<OpenInNewRoundedIcon />} sx={{ alignSelf: 'flex-start' }}>Open in Outlook</Button>
}

function ImportedAttachments({ importId, originalNames, webLink }) {
  const [attempt, setAttempt] = useState(0)
  const [files, setFiles] = useState(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const selected = files?.attachments.find((file) => file.attachmentId === selectedId)
  const loadUrls = useCallback(() => repository.urls(importId, selected), [importId, selected])
  const reload = () => { setFiles(null); setError(''); setSelectedId(null); setAttempt((value) => value + 1) }

  useEffect(() => {
    let active = true
    repository.list(importId).then((data) => { if (active) setFiles(data) })
      .catch((failure) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [importId, attempt])

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2" fontWeight={800}>Email attachments & extraction</Typography>
      <OutlookLink webLink={files?.webLink || webLink} />
      {error ? <Alert severity="error" action={<Button color="inherit" onClick={reload}>Retry loading</Button>}>{error}</Alert>
        : !files ? <Typography role="status" variant="body2">Loading original attachments…</Typography>
          : <>
            {!files.available && <Alert severity="warning">{files.sourceStatus === 'REJECTED'
              ? 'The original source was rejected.' : 'The complete original source is not yet available.'}
              {' '}A recovery PDF, when present, is a separate source.
              {originalNames.length > 0 && ` Original filenames: ${originalNames.join(', ')}.`}</Alert>}
            {files.attachments.length === 0 ? <Typography variant="body2" color="text.secondary">{files.available && originalNames.length === 0
              ? 'This email has no registered attachments.'
              : 'No attachment details are available. Any original filenames are metadata only.'}</Typography>
              : <>
                <List aria-label="Original email attachments" disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  {files.attachments.map((file) => (
                    <ListItemButton key={file.attachmentId} selected={file.attachmentId === selectedId}
                      onClick={() => setSelectedId(file.attachmentId)} aria-label={`Review ${file.originalFilename}`}>
                      <ListItemText primary={file.originalFilename}
                        secondary={`${file.mimeType} · ${fileSize(file.sizeBytes)}${file.isInline ? ' · Inline image' : ''} · ${
                          file.analysis?.status === 'ANALYZED' ? 'Analyzed' : file.analysis?.status === 'FAILED' ? 'Analysis failed' : 'Not analyzed'
                        }${file.retention === 'GRAPH_ONLY' ? ' · Image file not stored' : ''}`}
                        sx={{ overflowWrap: 'anywhere', minWidth: 0 }} />
                    </ListItemButton>
                  ))}
                </List>
                {selected ? <Stack key={selected.attachmentId} spacing={2}>
                  <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{selected.originalFilename}</Typography>
                  {selected.retention === 'GRAPH_ONLY'
                    ? <Alert severity="info">This image file is not stored in this application. Review its extracted information here, or open the original email in Outlook to view the image.</Alert>
                    : !canOpenImportSource(selected) && <Alert severity="warning">The original file is not available. Any retained extraction is shown below.</Alert>}
                  <ImportAttachmentAnalysis attachment={selected} />
                  {canOpenImportSource(selected) && <SourceFilePreview key={selected.fileId} loadUrls={loadUrls} />}
                </Stack>
                  : <Typography variant="body2" color="text.secondary">Select an attachment to review its extraction and any stored original file.</Typography>}
              </>}
          </>}
    </Stack>
  )
}

export default function OriginalEmailSource({ request }) {
  const email = request.sourceEmail ?? {}
  const body = email.body ?? ''
  const readableBody = useMemo(() => readableEmail(body, email.bodyFormat), [body, email.bodyFormat])
  const webLink = safeEmailWebLink(email.webLink)
  return (
    <Stack spacing={2}>
      <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '105px minmax(0, 1fr)' }, gap: 0.75 }}>
        {[
          ['From', [email.fromName, email.from].filter(Boolean).join(' · ') || 'Not available'],
          ['To', email.to?.join(', ') || 'Not available'],
          ...(email.cc?.length ? [['Cc', email.cc.join(', ')]] : []),
          ['Subject', email.subject || 'No subject'],
          ['Sent', emailDate(email.sentAt)], ['Received', emailDate(email.receivedAt)],
        ].map(([label, value]) => <Box key={label} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" fontWeight={700}>{label}</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{value}</Typography>
        </Box>)}
      </Box>
      <Typography variant="caption" color="text.secondary">Dates are shown in California time.</Typography>
      {!request.emailImportId && <OutlookLink webLink={webLink} />}
      {email.bodyFormat === 'HTML' && <Alert severity="info">The retained HTML email is displayed as plain text. Scripts, links and remote images are not loaded.</Alert>}
      {readableBody ? <Box component="pre" sx={{ m: 0, p: 2, maxHeight: '55vh', overflow: 'auto', whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere', fontSize: '0.875rem', fontFamily: 'inherit', border: 1, borderColor: 'divider', borderRadius: 1 }}>{readableBody}</Box>
        : <Alert severity="warning">The original email body is not available. No substitute content has been generated.</Alert>}
      {request.emailImportId && <ImportedAttachments key={request.emailImportId} importId={request.emailImportId}
        originalNames={email.attachmentNames ?? []} webLink={webLink} />}
    </Stack>
  )
}
