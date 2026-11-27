import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Collapse, Dialog,
  DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, List, ListItem,
  Paper, Stack, Tab, TablePagination, Tabs, TextField, Typography,
} from '@mui/material'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { requireSupabase } from '../../../services/api.js'
import { createCustomerServiceEmailInboxRepository, emailInboxImportReceipt } from '../services/customerServiceEmailInboxRepository.js'
import { createCustomerServiceEmailInboxStore, EMAIL_INBOX_PAGE_SIZE } from '../context/customerServiceEmailInboxStore.js'
import { canRetryInboxItem, emailInboxCounters, emailInboxItemState, emailInboxReason, emailInboxRequestLabel, emailInboxRequestStage, emailInboxReviewLabel } from '../utils/emailInboxPresentation.js'
import { formatEmailImportDate } from '../utils/emailImportProblems.js'
import EmailAutomationStatus from './EmailAutomationStatus.jsx'

const repository = createCustomerServiceEmailInboxRepository({ getClient: requireSupabase })

function Loading({ children }) {
  return <Stack role="status" direction="row" spacing={1} sx={{ alignItems: 'center', p: 2 }}>
    <CircularProgress size={18} /><Typography variant="body2">{children}</Typography>
  </Stack>
}

export default function EmailInboxPanel({ inboxRepository = repository, requests = [], automation, automationError,
  onRefreshAutomation, onOpenRequest, onRecover, onChanged }) {
  const store = useMemo(() => createCustomerServiceEmailInboxStore(inboxRepository), [inboxRepository])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const [target, setTarget] = useState(null)
  const [reviewed, setReviewed] = useState(false)
  const [opening, setOpening] = useState(false)
  const [navigationError, setNavigationError] = useState(null)
  const revision = automation?.inboxCounts?.revision
  useEffect(() => {
    return () => store.cancelLoads()
  }, [store])
  useEffect(() => {
    if (state.busy || confirmation) return
    if (open) void store.refresh()
    else void store.loadCounts()
  }, [store, revision, open, state.busy, confirmation])

  const busy = state.busy || opening || state.detailLoading
  const selected = state.selected
  const mutationBlocked = busy || (Boolean(state.unconfirmedAction) && state.unconfirmedAction.item.id === selected?.id
    && state.unconfirmedAction?.item.sourceKind === selected?.sourceKind)
  const count = state.counts?.[{ REQUIRES_ACTION: 'requiresAction', PROCESSING: 'processing', REGISTERED: 'registered' }[state.filter] ?? 'total'] ?? 0
  const refresh = async () => {
    setNavigationError(null)
    await Promise.all([open ? store.refresh() : store.loadCounts(), onRefreshAutomation?.()])
  }
  const navigateToRequest = async (item) => {
    if (!item?.requestId) return
    setOpening(true); setNavigationError(null)
    try { await onOpenRequest?.(item.requestId) }
    catch (error) { setNavigationError(error.message || 'The request could not be opened. Refresh the status.') }
    finally { setOpening(false) }
  }
  const openRecovery = async () => {
    setOpening(true); setNavigationError(null)
    try { await onRecover?.(emailInboxImportReceipt(selected)) }
    catch (error) { setNavigationError(error.message || 'Recovery could not be opened.') }
    finally { setOpening(false) }
  }
  const confirmAction = async () => {
    const candidate = confirmation
    const requestId = target?.id
    setConfirmation(null)
    const result = await store.act(candidate.kind, candidate.item, requestId)
    // Do not turn a successful recorded result into a failed import if a
    // separate request-list refresh fails; the inbox owns that result.
    if (result?.requestId) {
      try { await onChanged?.() }
      catch { setNavigationError('The result is saved, but the request list still needs to be refreshed.') }
    }
    await onRefreshAutomation?.()
  }
  const startConfirmation = (kind) => {
    setTarget(null); setReviewed(false)
    setConfirmation({ kind, item: selected })
  }
  const matchEmail = async (item) => {
    // Capture the current server version before the user reviews a match.
    const current = await store.select(item)
    if (current?.sourceKind === 'FOLDER_MESSAGE' && current.state === 'REQUIRES_ACTION') {
      setTarget(null); setReviewed(false)
      setConfirmation({ kind: 'CONFIRM', item: current })
    } else if (current) await store.refresh()
  }
  const result = state.result
  return <Box sx={{ mb: 2 }}>
    <EmailAutomationStatus status={automation} error={automationError} onRefresh={onRefreshAutomation} />
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Stack spacing={1.5} sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <MailOutlineRoundedIcon color="action" />
          <Typography component="h2" variant="subtitle1" fontWeight={800}>Outlook emails</Typography>
          <Button size="small" variant={open ? 'contained' : 'outlined'} disabled={busy}
            aria-expanded={open} aria-controls="customer-service-email-inbox" onClick={() => {
              setOpen(!open)
            }}>
            {open ? 'Hide emails' : emailInboxReviewLabel(state.counts)}
          </Button>
          <Button size="small" startIcon={<RefreshRoundedIcon />} disabled={busy || state.loading} onClick={() => { void refresh() }}>Refresh status</Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Each email shows its result and linked request. Registered requests still need human approval.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {emailInboxCounters.map((copy) => <Chip key={copy.key} size="small" variant="outlined"
            color={state.counts?.[copy.key] > 0 ? copy.color : 'default'} label={`${copy.label}: ${state.counts?.[copy.key] ?? '—'}`} />)}
        </Stack>
        {state.counts?.unmatched > 0 && <Typography variant="body2" color="text.secondary">
          Original emails and forwarded copies may need to be matched to an existing request. Confirming the correct match clears the email from review.
        </Typography>}
        {state.error && <Alert severity="warning">{state.error} Counts remain unconfirmed until refreshed.</Alert>}
        {navigationError && <Alert severity="warning">{navigationError}</Alert>}
        {state.actionError && <Alert severity="warning">{state.actionError}</Alert>}
        {state.busy && <Loading>Checking the saved result. Wait before starting another action…</Loading>}
        {result && <Alert severity={result.state === 'REGISTERED' ? 'success' : result.state === 'PROCESSING' ? 'info' : 'warning'}
          sx={{ flexWrap: { xs: 'wrap', sm: 'nowrap' }, '& .MuiAlert-message': { flex: 1, minWidth: 0 },
            '& .MuiAlert-action': { width: { xs: '100%', sm: 'auto' }, m: 0, pl: { xs: 4, sm: 2 }, pt: 0 } }}
          action={result.requestId ? <Button color="inherit" disabled={busy} onClick={() => { void navigateToRequest(result) }}>Open request {result.requestFolio}</Button> : undefined}>
          <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere', mb: 0.5 }}>{result.subject}</Typography>
          <Typography variant="body2">{result.state === 'REGISTERED'
            ? `Email successfully registered as ${result.requestFolio}. ${emailInboxRequestStage(result.requestWorkflowStage)}.`
            : emailInboxReason(result)}</Typography>
        </Alert>}
      </Stack>
      <Collapse in={open}>
        <Box id="customer-service-email-inbox">
          <Tabs value={state.filter ?? 'ALL'} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile aria-label="Outlook email status"
            onChange={(_, value) => { store.clearSelection(); void store.refresh(value === 'ALL' ? null : value, 0) }}>
            <Tab value="REQUIRES_ACTION" label="To review" disabled={busy} />
            <Tab value="PROCESSING" label="Processing" disabled={busy} />
            <Tab value="REGISTERED" label="Registered" disabled={busy} />
            <Tab value="ALL" label="All" disabled={busy} />
          </Tabs>
          {state.loading ? <Loading>Loading emails…</Loading> : !state.error && state.items.length === 0
            ? <Typography role="status" variant="body2" sx={{ p: 2 }}>
              {state.filter === 'REQUIRES_ACTION' ? 'No emails need review in this view.' : 'No emails have this status.'}
            </Typography> : <List disablePadding aria-label="Outlook email inbox">
              {state.items.map((item) => <ListItem key={`${item.sourceKind}:${item.id}`} sx={{ p: 2, borderBottom: 1, borderColor: 'divider',
                bgcolor: selected?.id === item.id && selected.sourceKind === item.sourceKind ? 'action.selected' : undefined }}>
                <Stack spacing={0.75} sx={{ width: '100%', minWidth: 0, overflowWrap: 'anywhere' }}>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                    <Button color="inherit" disabled={busy} onClick={() => { void store.select(item) }}
                      aria-label={`Review email: ${item.subject}`} sx={{ p: 0, maxWidth: '100%', textAlign: 'left', textTransform: 'none', justifyContent: 'flex-start' }}>
                      <Typography variant="body2" fontWeight={700}>{item.subject}</Typography>
                    </Button>
                    <Chip size="small" color={emailInboxItemState(item).color} label={emailInboxItemState(item).label} />
                  </Stack>
                  {item.sender && <Typography variant="body2" color="text.secondary">{item.sender}</Typography>}
                  {item.metadataPending && <Typography variant="caption" color="text.secondary">Subject and sender will appear after the next automatic Outlook check, within 15 minutes. You can open the original email from its details.</Typography>}
                  <Typography variant="body2">{emailInboxReason(item)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.receivedAt ? 'Received' : 'Detected'}: {formatEmailImportDate(item.receivedAt ?? item.createdAt)}
                  </Typography>
                  {item.sourceKind === 'FOLDER_MESSAGE' && item.state === 'REQUIRES_ACTION' && <Box>
                    <Button size="small" variant="outlined" disabled={busy || state.unconfirmedAction?.item.id === item.id}
                      onClick={() => { void matchEmail(item) }}>Match existing request</Button>
                  </Box>}
                  {item.requestId && <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button size="small" disabled={busy} onClick={() => { void navigateToRequest(item) }}>Open request {item.requestFolio}</Button>
                    <Typography variant="caption">{emailInboxRequestStage(item.requestWorkflowStage)}</Typography>
                  </Stack>}
                </Stack>
              </ListItem>)}
            </List>}
          {state.counts && count > EMAIL_INBOX_PAGE_SIZE && <TablePagination component="div" count={count} page={state.page}
            rowsPerPage={EMAIL_INBOX_PAGE_SIZE} rowsPerPageOptions={[]} onPageChange={(_, page) => { store.clearSelection(); void store.refresh(state.filter, page) }}
            disabled={busy} labelDisplayedRows={({ from, to, count: total }) => `${from}–${to} of ${total}`}
            getItemAriaLabel={(type) => type === 'next' ? 'Next page' : 'Previous page'} />}
          {state.detailLoading && <Loading>Checking the current email status…</Loading>}
          {state.detailError && <Alert severity="warning" sx={{ m: 2 }}>{state.detailError}</Alert>}
          {selected && <Stack role="region" aria-label="Review selected email" spacing={1.5} sx={{ p: 2, bgcolor: 'action.hover' }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1 }}>
              <Typography variant="subtitle2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{selected.subject}</Typography>
              <Button size="small" disabled={busy} onClick={store.clearSelection}>Close details</Button>
            </Stack>
            <Typography variant="body2">{emailInboxReason(selected)}</Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {selected.webLink && <Button component="a" href={selected.webLink} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                size="small" startIcon={<OpenInNewRoundedIcon />}>Open original email</Button>}
              {selected.requestId && <Button disabled={busy} onClick={() => { void navigateToRequest(selected) }}>Open request {selected.requestFolio}</Button>}
              {canRetryInboxItem(selected) && <Button variant="contained" disabled={mutationBlocked} onClick={() => startConfirmation('RETRY')}>Retry analysis</Button>}
              {selected.sourceKind === 'IMPORT' && selected.state === 'REQUIRES_ACTION' && onRecover && <Button variant="outlined" disabled={mutationBlocked} onClick={() => { void openRecovery() }}>
                {selected.reasonCode === 'RECOVERY_PDF_PENDING' ? 'Complete PDF recovery' : 'Complete details / recover with PDF'}
              </Button>}
              {selected.sourceKind === 'FOLDER_MESSAGE' && selected.state === 'REQUIRES_ACTION'
                && <Button variant="contained" disabled={mutationBlocked} onClick={() => startConfirmation('CONFIRM')}>Match existing request</Button>}
            </Stack>
            {selected.sourceKind === 'FOLDER_MESSAGE' && selected.state === 'REQUIRES_ACTION' && <Typography variant="body2" color="text.secondary">
              For a new case, create a request from New Request, then return here to match the email. Compare the actual case details before confirming.
            </Typography>}
            {selected.nextAttemptAt && <Typography variant="caption">Next attempt after: {formatEmailImportDate(selected.nextAttemptAt)}</Typography>}
          </Stack>}
        </Box>
      </Collapse>
    </Paper>
    <Dialog open={Boolean(confirmation)} onClose={() => { if (!busy) setConfirmation(null) }} fullWidth maxWidth="sm"
      aria-labelledby="email-inbox-confirm-title">
      <DialogTitle id="email-inbox-confirm-title">{confirmation?.kind === 'CONFIRM' ? 'Match this email to a request' : 'Retry this email analysis'}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{confirmation?.item.subject}</DialogContentText>
        {confirmation?.kind === 'CONFIRM' ? <Stack spacing={2}>
          <Typography variant="body2">Compare the homeowner, address and requested work before confirming.</Typography>
          <Autocomplete options={requests} value={target} onChange={(_, value) => { setTarget(value); setReviewed(false) }}
            openText="Show requests" closeText="Hide requests" clearText="Clear selection"
            getOptionLabel={emailInboxRequestLabel} isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText="No requests found. Refresh the list or create one from New Request."
            renderInput={(params) => <TextField {...params} label="Search by request number, homeowner or address" />} />
          {target && <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle2">{target.requestNumber}</Typography>
            <Typography variant="body2">{target.contactName}</Typography>
            <Typography variant="body2">{[target.street, target.city, target.state].filter(Boolean).join(', ')}</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>{target.issue}</Typography>
            <Button size="small" onClick={() => { void navigateToRequest({ requestId: target.id }) }}>Open request to compare</Button>
          </Paper>}
          <FormControlLabel control={<Checkbox checked={reviewed} disabled={!target} onChange={(event) => setReviewed(event.target.checked)} />}
            label="I reviewed the details and confirm this is the same case." />
          <Typography variant="body2" color="text.secondary">Your confirmation will be recorded. Saving the link removes this email from review without creating another request or approving it.</Typography>
        </Stack> : <DialogContentText>
          This import will resume using its completed valid analyses. It may require another AI service call.
          The saved result will be checked afterward. Human review of the request remains pending.
        </DialogContentText>}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button>
        <Button variant="contained" disabled={busy || (confirmation?.kind === 'CONFIRM' && (!target || !reviewed))}
          onClick={() => { void confirmAction() }}>{confirmation?.kind === 'CONFIRM' ? 'Confirm match' : 'Confirm retry'}</Button>
      </DialogActions>
    </Dialog>
  </Box>
}
