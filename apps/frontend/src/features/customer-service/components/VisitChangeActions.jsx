import { useState } from 'react'
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton, Stack } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded'
import EventRepeatRoundedIcon from '@mui/icons-material/EventRepeatRounded'
import { useAuth } from '../../auth/context/useAuth.js'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'
import {
  buildVisitCancel, canChangeVisit, currentVisit, requestPlanningForMove, requestsPlanningForMove,
  visitCancelledNotice, visitMovedNotice,
} from '../utils/customerServiceVisitChanges.js'
import CancelVisitDialog from './CancelVisitDialog.jsx'
import ProposalDraftPlanner from './ProposalDraftPlanner.jsx'

// The planner reports unsaved changes; while moving there is no draft to keep.
const ignoreDirty = () => {}
const ignoreSave = () => {}

// Move visit and Cancel visit (Reschedule block, 27 Nov 2026), live or in test mode, until
// the visit's window ends (decision P2). Moving opens the planner over the whole screen with
// the visit freed from its own slot; the coordinator picks the day agreed with the customer.
// onChanged(notice) runs after either change, with what to tell the coordinator.
// The Calendar passes these buttons to the visit panel, so the panel does not import the
// planner (the planner's day agenda shows the same panel).
export default function VisitChangeActions({ requestId, onChanged }) {
  const { requests, technicians, cancelVisit } = useCustomerServicePrototype()
  const { profile } = useAuth()
  const [open, setOpen] = useState(null)
  const request = requests.find((entry) => String(entry.id) === String(requestId))
  if (!request || !canChangeVisit(request)) return null
  const close = () => setOpen(null)
  return (
    <>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', '& > *': { flex: '1 1 140px' } }}>
        <Button variant="contained" startIcon={<EventRepeatRoundedIcon />} onClick={() => setOpen('MOVE')}>Move visit</Button>
        <Button variant="outlined" color="error" startIcon={<EventBusyRoundedIcon />} onClick={() => setOpen('CANCEL')}>
          Cancel visit
        </Button>
      </Stack>
      {open === 'MOVE' && (
        <Dialog open fullScreen onClose={close}>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1 }}>Move visit · {request.requestNumber}</Box>
            <IconButton onClick={close} aria-label="Close without moving"><CloseRoundedIcon /></IconButton>
          </DialogTitle>
          <DialogContent dividers>
            <ProposalDraftPlanner
              request={requestPlanningForMove(request)} requests={requestsPlanningForMove(requests, request)}
              technicians={technicians} savedDraft={null} onSave={ignoreSave} onDirtyChange={ignoreDirty}
              moving={{ request, previous: currentVisit(request) }}
              onMoved={(result, values) => {
                close()
                onChanged(visitMovedNotice(request.requestNumber, values.date, result))
              }} />
          </DialogContent>
        </Dialog>
      )}
      {open === 'CANCEL' && (
        <CancelVisitDialog request={request} requests={requests} senderEmail={profile?.email ?? ''} onClose={close}
          onCancel={async (choice) => {
            const result = await cancelVisit(buildVisitCancel({ request, ...choice }))
            close()
            onChanged(visitCancelledNotice(request.requestNumber, result))
          }} />
      )}
    </>
  )
}
