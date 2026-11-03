import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Divider,
  Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  List, ListItemButton, Paper, Stack, TablePagination, Typography,
} from '@mui/material'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { requireSupabase } from '../../../services/api.js'
import { createCustomerServiceEmailImportRepository } from '../services/customerServiceEmailImportRepository.js'
import { createCustomerServiceEmailImportStore, EMAIL_IMPORT_PAGE_SIZE } from '../context/customerServiceEmailImportStore.js'
import { canRetryEmailImport, emailImportProblemTitle, formatEmailImportDate } from '../utils/emailImportProblems.js'

const repository = createCustomerServiceEmailImportRepository({ getClient: requireSupabase })

function Loading({ children }) {
  return (
    <Stack role="status" direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 2 }}>
      <CircularProgress size={20} />
      <Typography variant="body2">{children}</Typography>
    </Stack>
  )
}

export default function EmailImportProblemsPanel({ importRepository = repository, onRecover, onRequestsChanged, problemCount }) {
  const store = useMemo(() => createCustomerServiceEmailImportStore(importRepository), [importRepository])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [open, setOpen] = useState(false)
  const [retryCandidate, setRetryCandidate] = useState(null)
  const [recoveryError, setRecoveryError] = useState(null)
  const [openingRecovery, setOpeningRecovery] = useState(false)
  useEffect(() => {
    void store.loadCount()
    return () => store.cancelLoads()
  }, [store])
  useEffect(() => {
    if (problemCount !== undefined) void store.loadCount()
  }, [store, problemCount])
  const busy = state.loading || state.countLoading || state.retrying || openingRecovery
  const refresh = () => { void (open ? store.loadPage(state.page) : store.loadCount()) }
  const toggle = () => {
    if (!open) void store.loadPage(0)
    else store.clearSelection()
    setOpen(!open)
  }
  const detail = state.detail
  const runRetry = async () => {
    const candidate = retryCandidate
    setRetryCandidate(null)
    const result = await store.retryImport(candidate)
    if (result?.requestId != null) await onRequestsChanged?.()
  }
  const recover = async () => {
    setOpeningRecovery(true)
    setRecoveryError(null)
    try { await onRecover(detail) }
    catch (error) { setRecoveryError(error.message || 'Recovery could not be opened.') }
    finally { setOpeningRecovery(false) }
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant={open ? 'contained' : 'outlined'}
          color={state.count > 0 ? 'warning' : 'inherit'}
          startIcon={state.countLoading ? <CircularProgress size={18} color="inherit" /> : <ErrorOutlineRoundedIcon />}
          aria-expanded={open}
          aria-controls="email-import-problems-panel"
          disabled={state.retrying || openingRecovery}
          onClick={toggle}
        >
          Emails with import issues · {state.countLoading ? '…' : state.count ?? '—'}
        </Button>
        <Button size="small" color="inherit" startIcon={<RefreshRoundedIcon />} disabled={busy} onClick={refresh}>
          Refresh emails
        </Button>
        {state.countError && !open && (
          <Typography role="alert" variant="body2" color="error">{state.countError}</Typography>
        )}
      </Stack>
      {state.retrying && <Loading>Retrying this import. Keep this view open until the result is known…</Loading>}
      {state.retryError && <Alert severity="error" sx={{ mt: 1 }}>{state.retryError}</Alert>}
      {recoveryError && <Alert severity="error" sx={{ mt: 1 }}>{recoveryError}</Alert>}
      {state.retryResult && (
        <Alert severity={state.retryResult.status === 'PROCESSED' ? 'success' : 'info'} sx={{ mt: 1 }}>
          {state.retryResult.requestId != null
            ? `The import is linked to request ID ${state.retryResult.requestId}. Human approval is still required.`
            : state.retryResult.status === 'NEEDS_ATTENTION'
              ? 'The email still needs attention. Review the current reason; you can continue analysis if progress is available.'
              : 'Processing is pending or in progress. Refresh to check the saved result.'}
        </Alert>
      )}

      <Collapse in={open}>
        <Paper
          component="section" id="email-import-problems-panel" aria-labelledby="email-import-problems-title"
          variant="outlined" sx={{ mt: 1.5, overflow: 'hidden', borderRadius: 2 }}
        >
          <Box sx={{ p: 2 }}>
            <Typography id="email-import-problems-title" component="h2" variant="subtitle1" fontWeight={800}>
              Emails that need attention
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Import issues only. Requests awaiting human review are tracked separately. Dates use California time.
            </Typography>
          </Box>
          <Divider />
          <Box sx={{ display: 'grid', gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: state.selectedId ? 'minmax(0, 1fr) minmax(0, 0.9fr)' : 'minmax(0, 1fr)',
          } }}>
          <Box sx={{ minWidth: 0 }}>
          {state.loading ? <Loading>Loading emails with import issues…</Loading> : state.error ? (
            <Alert severity="error" sx={{ m: 2 }} action={<Button color="inherit" onClick={refresh}>Refresh</Button>}>
              {state.error}
            </Alert>
          ) : (
            <>
              {state.items.length === 0 ? (
                <Typography role="status" variant="body2" sx={{ p: 2 }}>No emails have import issues in this view.</Typography>
              ) : (
                <List disablePadding aria-label="Emails with import issues" sx={{ maxHeight: { xs: 320, md: 440 }, overflowY: 'auto' }}>
                  {state.items.map((item) => (
                    <ListItemButton
                      key={item.id} selected={state.selectedId === item.id}
                      disabled={state.retrying || openingRecovery}
                      onClick={() => { void store.selectImport(item.id) }}
                      aria-label={`View import: ${item.subject}`}
                      aria-pressed={state.selectedId === item.id}
                      sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', alignItems: 'flex-start' }}
                    >
                      <Box sx={{ minWidth: 0, width: '100%', overflowWrap: 'anywhere' }}>
                        <Typography variant="body2" fontWeight={700}>{item.subject}</Typography>
                        <Typography variant="body2" color="text.secondary">{item.sender}</Typography>
                        <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>
                          {emailImportProblemTitle(item.errorCode)}
                        </Typography>
                        <Typography variant="body2">{item.errorMessage || 'View the import details.'}</Typography>
                        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                          Registrado: {formatEmailImportDate(item.createdAt)} · Last attempt: {formatEmailImportDate(item.lastAttemptAt)}
                          {item.requestFolio ? ` · Request: ${item.requestFolio}` : ''}
                        </Typography>
                      </Box>
                    </ListItemButton>
                  ))}
                </List>
              )}
              {state.count !== null && state.count > EMAIL_IMPORT_PAGE_SIZE && (
                <TablePagination
                  component="div" count={state.count} page={state.page} rowsPerPage={EMAIL_IMPORT_PAGE_SIZE}
                  rowsPerPageOptions={[]} onPageChange={(_, page) => { void store.loadPage(page) }}
                  labelDisplayedRows={({ from, to, count }) => `${from}–${to} of ${count}`}
                  getItemAriaLabel={(type) => type === 'next' ? 'Next email page' : 'Previous email page'}
                />
              )}
            </>
          )}
          </Box>
          {state.selectedId && (
            <Box role="region" aria-label="Import details" sx={{ p: 2, bgcolor: 'action.hover', overflowWrap: 'anywhere' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography component="h3" variant="subtitle2" fontWeight={800}>Import details</Typography>
                <Button size="small" color="inherit" disabled={state.retrying || openingRecovery} onClick={store.clearSelection}>Close details</Button>
              </Stack>
              {state.detailLoading ? <Loading>Loading details…</Loading> : state.detailError ? (
                <Alert severity="error" action={(
                  <Button color="inherit" onClick={() => { void store.selectImport(state.selectedId) }}>Refresh</Button>
                )}>{state.detailError}</Alert>
              ) : detail && (
                <Stack spacing={1}>
                  <Typography variant="body2" fontWeight={700}>{detail.subject}</Typography>
                  <Typography variant="body2">{detail.sender}</Typography>
                  {detail.status !== 'NEEDS_ATTENTION' && (
                    <Alert severity="info">This email status changed. Refresh the list to see current issues.</Alert>
                  )}
                  <Box><Chip size="small" variant="outlined" label={detail.status} /></Box>
                  <Typography variant="body2">{detail.errorMessage || 'No current error is recorded.'}</Typography>
                  <Typography variant="caption">Code: {detail.errorCode || 'Not available'} · Attempts: {detail.attemptCount}</Typography>
                  <Typography variant="caption">Last attempt: {formatEmailImportDate(detail.lastAttemptAt)}</Typography>
                  <Typography variant="caption">Updated: {formatEmailImportDate(detail.updatedAt)}</Typography>
                  {detail.nextAttemptAt && <Typography variant="caption">Next attempt after: {formatEmailImportDate(detail.nextAttemptAt)}</Typography>}
                  <Typography variant="caption">Import: {detail.id}</Typography>
                  <Typography variant="body2">
                    Linked request: {detail.requestFolio || (detail.requestId != null ? `ID ${detail.requestId}` : 'No request has been created')}
                  </Typography>
                  {detail.webLink ? (
                    <Box>
                      <Button component="a" href={detail.webLink} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                        size="small" startIcon={<OpenInNewRoundedIcon />}>
                        Open original email
                      </Button>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">The original email link is not available.</Typography>
                  )}
                  <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
                    <Button variant="outlined" size="small" disabled={busy || !canRetryEmailImport(detail)}
                      onClick={() => setRetryCandidate(detail)}>
                      {['WORKER_CONTINUATION_REQUIRED', 'WORKER_TEMPORARY_FAILURE'].includes(detail.errorCode) ? 'Continue analysis' : 'Retry analysis'}
                    </Button>
                    {onRecover && <Button variant="contained" size="small"
                      disabled={busy || (detail.requestId == null && detail.status !== 'NEEDS_ATTENTION')}
                      onClick={() => { void recover() }}>
                      {detail.errorCode === 'RECOVERY_PDF_PENDING' ? 'Complete PDF recovery'
                        : detail.requestId != null ? 'Open linked request' : 'Recover with PDF / form'}
                    </Button>}
                  </Stack>
                  {!canRetryEmailImport(detail) && detail.requestId == null && (
                    <Typography variant="caption" color="text.secondary">
                      Retry requires the complete original source to be available. Recover a rejected source with a valid PDF or manual entry.
                    </Typography>
                  )}
                </Stack>
              )}
            </Box>
          )}
          </Box>
        </Paper>
      </Collapse>
      <Dialog open={Boolean(retryCandidate)} onClose={() => setRetryCandidate(null)} maxWidth="xs" fullWidth
        aria-labelledby="email-retry-confirm-title">
        <DialogTitle id="email-retry-confirm-title">Retry the analysis?</DialogTitle>
        <DialogContent><DialogContentText>
          The same import will be processed, preserving its sources and avoiding duplicate requests.
          This may use the AI service again. The result will still need human review.
        </DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setRetryCandidate(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => { void runRetry() }}>Confirm retry</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
