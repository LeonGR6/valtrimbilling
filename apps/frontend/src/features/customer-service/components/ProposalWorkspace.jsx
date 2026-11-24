import { useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, FormControl, InputLabel, Link, MenuItem,
  Paper, Select, Stack, TextField, Typography,
} from '@mui/material'
import { formatPhoneNumber } from '../../../utils/phoneNumbers.js'
import {
  canEditRequestInView, defaultProposalStage, effectiveRequestWorkflowStage, filterAndSortRequestInbox,
  findRequestForView, isRequestOverdue,
  paginateRequestInbox, proposalFilterOptions, requestLocationLabel,
  requestsForView, requestWorkflowStages,
} from '../utils/requestInbox.js'
import { latestProposalAnswer, proposalOptionsStatus } from '../utils/proposalAnswers.js'
import RequestInboxList from './RequestInboxList.jsx'
import ProposalAnswerPanel from './ProposalAnswerPanel.jsx'
import ProposalDraftPlanner from './ProposalDraftPlanner.jsx'

export default function ProposalWorkspace({
  requests, selectedRequestId, onSelectRequest, onView, onEdit, onViewSource, onBackToRequests,
  proposalDrafts, onSaveDraft, technicians, onDraftDirtyChange, onBeforeLeave, onRegistered, onProposalSent, onProposalAnswered,
}) {
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState(() => {
    const initial = findRequestForView(requests, selectedRequestId, 'PROPOSALS')
    return initial ? effectiveRequestWorkflowStage(initial) : defaultProposalStage
  })
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const queue = useMemo(() => requestsForView(requests, 'PROPOSALS'), [requests])
  const matches = useMemo(() => filterAndSortRequestInbox(requests, {
    view: 'PROPOSALS', search, stage,
  }), [requests, search, stage])
  const pagination = paginateRequestInbox(matches, page, rowsPerPage)
  const selected = findRequestForView(requests, selectedRequestId, 'PROPOSALS')
  const selectedStage = selected && effectiveRequestWorkflowStage(selected)
  const selectedWorkflow = selected && requestWorkflowStages[selectedStage]
  const lastAnswer = selected && latestProposalAnswer(selected, selectedStage)
  // Every offered day started without an answer: plan again; the new proposal or visit
  // closes the old one (decided 23 Nov 2026).
  const daysPassed = selectedStage === 'AWAITING_CUSTOMER' && proposalOptionsStatus(selected).allStarted
  // A request just registered (by phone or an accepted proposal) leaves the workspace.
  const leftRequest = selectedRequestId && !selected
    ? requests.find((request) => String(request.id) === String(selectedRequestId))
    : null
  const confirmedElsewhere = leftRequest && ['CONFIRMED', 'WORKING', 'COMPLETED'].includes(effectiveRequestWorkflowStage(leftRequest))
    ? leftRequest
    : null
  const changeStage = (value) => {
    const change = () => {
      setStage(value)
      setPage(0)
      if (selected && value !== 'all' && value !== effectiveRequestWorkflowStage(selected)) {
        onSelectRequest(undefined)
      }
    }
    if (selected && value !== 'all' && value !== effectiveRequestWorkflowStage(selected)) onBeforeLeave(change)
    else change()
  }
  const selectRequest = (request) => {
    if (request?.id === selected?.id) return
    onBeforeLeave(() => {
      setStage(request ? effectiveRequestWorkflowStage(request) : defaultProposalStage)
      setPage(0)
      onSelectRequest(request)
    })
  }

  return (
    <Stack spacing={2.5}>
      <Alert severity="info" variant="outlined">
        Pick a Ready to propose request, use its recommended slot or plan it by hand, and use Send to customer: email a
        proposal that holds its days until the customer answers, or register the visit they accepted by phone. Record
        their answer in Awaiting customer. Ready to propose and Needs contact requests can be edited here; changing the
        property or the work sends them back to Needs review.
      </Alert>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }} aria-label="Proposal workflow stages">
        {proposalFilterOptions.filter((option) => option.value !== 'all').map((option) => (
          <Chip
            key={option.value}
            label={`${option.label} (${queue.filter((request) => effectiveRequestWorkflowStage(request) === option.value).length})`}
            color={requestWorkflowStages[option.value].color}
            variant={stage === option.value ? 'filled' : 'outlined'}
            aria-pressed={stage === option.value}
            onClick={() => changeStage(option.value)}
          />
        ))}
      </Stack>

      <FormControl fullWidth sx={{ maxWidth: 650 }}>
        <InputLabel id="proposal-request-label">Selected request</InputLabel>
        <Select
          labelId="proposal-request-label"
          label="Selected request"
          value={selected?.id ?? ''}
          onChange={(event) => selectRequest(queue.find((request) => request.id === event.target.value))}
        >
          <MenuItem value="">Select a request</MenuItem>
          {queue.map((request) => (
            <MenuItem key={request.id} value={request.id}>
              {request.requestNumber} · {request.contactName || 'Customer pending'} · {requestWorkflowStages[effectiveRequestWorkflowStage(request)].label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {selectedRequestId && !selected && (confirmedElsewhere ? (
        <Alert severity="success" variant="outlined"
          action={<Button color="inherit" onClick={() => onSelectRequest(undefined)}>Close</Button>}>
          {confirmedElsewhere.requestNumber} is confirmed and appears in Calendar.
        </Alert>
      ) : (
        <Alert severity="warning" action={<Button color="inherit" onClick={onBackToRequests}>Requests</Button>}>
          This request is not available for proposals. It may require review again.
        </Alert>
      ))}

      {selected && (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="h6" fontWeight={800}>{selected.requestNumber}</Typography>
              <Chip size="small" color={selectedWorkflow.color} label={selectedWorkflow.label} />
              {isRequestOverdue(selected) && <Chip size="small" color="error" variant="outlined" label="Overdue" />}
            </Stack>
            {selectedStage === 'NEEDS_CONTACT' && !lastAnswer && (
              <Alert severity="warning" variant="outlined">
                Request review is complete. Contact the customer before continuing with a new proposal.
              </Alert>
            )}
            {lastAnswer && (
              <Alert severity={lastAnswer.severity} variant="outlined">
                <Typography variant="body2" fontWeight={700}>{lastAnswer.title}</Typography>
                {lastAnswer.detail}
                {lastAnswer.note && <Typography variant="body2" sx={{ mt: 0.5 }}>Customer note: {lastAnswer.note}</Typography>}
              </Alert>
            )}
            {selectedStage === 'AWAITING_CUSTOMER' && (
              <Alert severity="info" variant="outlined">
                A proposal has been sent. The appointment is not confirmed until the customer accepts it.
              </Alert>
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Property</Typography>
                <Typography variant="body2">{requestLocationLabel(selected)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Customer</Typography>
                <Typography variant="body2">
                  {selected.contactName || 'Customer pending'} · {selected.contactPhone
                    ? <Link href={`tel:${selected.contactPhone}`}>{formatPhoneNumber(selected.contactPhone)}</Link>
                    : 'Phone pending'}
                  {' · '}{selected.contactEmail || 'Email pending'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Work and planning estimate</Typography>
                <Typography variant="body2">
                  {selected.workType} · {selected.estimatedDurationMinutes ? `${selected.estimatedDurationMinutes} min` : 'Duration pending'}
                  {' · '}{selected.crewSize ? `${selected.crewSize} crew` : 'Crew pending'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Work items</Typography>
                <Typography variant="body2">{selected.requestedWorkItems?.length ?? 0} recorded</Typography>
              </Box>
            </Box>
            <Typography variant="body2">{selected.issue || selected.description}</Typography>
            {selected.customerAvailabilityNotes && (
              <Typography variant="body2" color="text.secondary">Customer notes: {selected.customerAvailabilityNotes}</Typography>
            )}
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button variant="outlined" onClick={() => onView(selected)}>View full request</Button>
              <Button variant="outlined" onClick={() => onViewSource(selected)}>View source & extraction</Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {selectedStage === 'AWAITING_CUSTOMER' && (
        <ProposalAnswerPanel key={selected.id} request={selected} technicians={technicians} onAnswered={onProposalAnswered} />
      )}

      {/* After a rejection the coordinator calls the customer, then plans again from Needs contact. */}
      {(['READY_TO_PROPOSE', 'NEEDS_CONTACT'].includes(selectedStage) || daysPassed) && (
        <ProposalDraftPlanner
          key={selected.id}
          request={selected}
          requests={requests}
          technicians={technicians}
          savedDraft={proposalDrafts[selected.id]}
          onSave={onSaveDraft}
          onDirtyChange={onDraftDirtyChange}
          onRegistered={onRegistered}
          onProposalSent={onProposalSent}
        />
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          size="small" label="Search proposals" value={search} fullWidth
          onChange={(event) => { setSearch(event.target.value); setPage(0) }}
        />
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="proposal-stage-label">Stage</InputLabel>
          <Select
            labelId="proposal-stage-label" label="Stage" value={stage}
            onChange={(event) => changeStage(event.target.value)}
          >
            {proposalFilterOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Typography variant="subtitle1" fontWeight={800} sx={{ px: 2.5, pt: 2 }}>
          {stage === 'all' ? 'Proposal queue' : requestWorkflowStages[stage].label}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2.5, pb: 2 }}>
          {matches.length} of {queue.length} requests · Ready to propose, Awaiting customer and Needs contact
        </Typography>
        <RequestInboxList
          requests={pagination.items} totalCount={matches.length} page={pagination.page} rowsPerPage={pagination.rowsPerPage}
          onPageChange={setPage} onRowsPerPageChange={(value) => { setRowsPerPage(value); setPage(0) }}
          onView={onView} onViewPdf={onViewSource} onOpenProposal={selectRequest}
          onEdit={onEdit} canEdit={(request) => canEditRequestInView(request, 'PROPOSALS')}
        />
      </Paper>

    </Stack>
  )
}
