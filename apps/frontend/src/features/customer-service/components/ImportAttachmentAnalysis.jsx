import { Alert, Box, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'

const text = (value) => typeof value === 'string' ? value : ''
const objects = (value) => Array.isArray(value) ? value.filter((part) => part && typeof part === 'object') : []

function TextReference({ children }) {
  return <Box component="pre" sx={{ m: 0, p: 1.5, maxHeight: '40vh', overflow: 'auto', whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere', fontFamily: 'inherit', fontSize: '0.875rem', border: 1, borderColor: 'divider', borderRadius: 1 }}>{children}</Box>
}

function FactRows({ rows }) {
  const present = rows.filter(([, value]) => typeof value === 'string' && value.trim())
  if (!present.length) return null
  return <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '150px minmax(0, 1fr)' }, gap: 0.75 }}>
    {present.map(([label, value]) => <Box key={label} sx={{ display: 'contents' }}>
      <Typography component="dt" variant="body2" fontWeight={700}>{label}</Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{value}</Typography>
    </Box>)}
  </Box>
}

export default function ImportAttachmentAnalysis({ attachment }) {
  const analysis = attachment.analysis
  if (!analysis) return <Alert severity="info">Not analyzed: no retained analysis is available for this attachment.</Alert>
  if (analysis.status === 'FAILED') return <Alert severity="error">
    Analysis failed. {analysis.error.message} ({analysis.error.code})
    {' '}Review the original email; any available extraction remains separate from manual form corrections.
  </Alert>
  const facts = analysis.structuredData
  const document = facts.document ?? {}
  const property = facts.property ?? {}
  const contacts = objects(facts.contacts)
  const items = objects(facts.serviceItems)
  const warnings = Array.isArray(facts.warnings) ? facts.warnings.filter((value) => typeof value === 'string') : []
  const factRows = [
    ['Document', document.documentTitle], ['Issuer', document.issuerName],
    ['Work orders', Array.isArray(document.workOrderNumbers) ? document.workOrderNumbers.map(text).filter(Boolean).join(', ') : null],
    ['Order date', document.orderDate], ['Scheduled date', document.scheduledDate],
    ['Source email date', document.sourceEmailSentDate], ['Source email from', document.sourceEmailFrom],
    ['Source subject', document.sourceEmailSubject], ['Builder', property.builderName],
    ['Community', property.communityName], ['Lot', property.lotNumber], ['Model', property.model], ['Address', property.address],
    ['Coordinates', Number.isFinite(property.coordinates?.latitude) && Number.isFinite(property.coordinates?.longitude)
      ? `${property.coordinates.latitude}, ${property.coordinates.longitude}` : null],
  ]
  const hasFacts = contacts.length || items.length || factRows.some(([, value]) => text(value).trim())
  return <Stack spacing={1.5}>
    <Typography variant="subtitle2" fontWeight={800}>Analyzed attachment</Typography>
    <Typography variant="body2" color="text.secondary">Extracted reference information. Review it before approving the request.</Typography>
    <Typography variant="subtitle2">Extracted text</Typography>
    {analysis.text?.trim() ? <TextReference>{analysis.text}</TextReference>
      : <Typography variant="body2" color="text.secondary">{attachment.mimeType.startsWith('image/')
        ? 'No relevant text was extracted from this image. The image analysis completed successfully.'
        : 'No extracted text is available for this document.'}</Typography>}
    <Typography variant="subtitle2">Extracted information</Typography>
    <FactRows rows={factRows} />
    {contacts.length > 0 && <Box>
      <Typography variant="body2" fontWeight={700}>Contacts reported by this source</Typography>
      <List dense disablePadding>{contacts.map((contact, index) => <ListItem key={index} disableGutters>
        <ListItemText primary={text(contact.name) || 'Name not provided'} secondary={[
          text(contact.sourceLabel), text(contact.role), text(contact.email),
          ...objects(contact.phones).map((phone) => text(phone.number)),
        ].filter(Boolean).join(' · ')} sx={{ overflowWrap: 'anywhere' }} />
      </ListItem>)}</List>
    </Box>}
    {items.length > 0 && <Box>
      <Typography variant="body2" fontWeight={700}>Work reported by this source</Typography>
      <List dense disablePadding>{items.map((item, index) => <ListItem key={index} disableGutters>
        <ListItemText primary={text(item.description) || text(item.requestedAction) || 'Work description not provided'} secondary={[
          text(item.description) && text(item.requestedAction), text(item.location),
          text(item.assignedVendor) && `Vendor: ${item.assignedVendor}`,
          text(item.suggestedWorkType) && `Suggested work type: ${item.suggestedWorkType}`,
          ...(Array.isArray(item.reviewReasons) ? item.reviewReasons.map(text) : []),
        ].filter(Boolean).join(' · ')} sx={{ overflowWrap: 'anywhere' }} />
      </ListItem>)}</List>
    </Box>}
    {!hasFacts && <Typography variant="body2" color="text.secondary">No request details were identified in this attachment.</Typography>}
    {warnings.length > 0 && <Alert severity="warning"><Typography variant="body2" fontWeight={700}>Source review notes</Typography>
      <Box component="ul" sx={{ my: 0, pl: 2 }}>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</Box>
    </Alert>}
  </Stack>
}
