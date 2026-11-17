import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import EventRoundedIcon from '@mui/icons-material/EventRounded'

import { useAuth } from '../../auth/context/useAuth.js'
import { canOpenPage } from '../../auth/authorization/roleAccess.js'
import {
  calendarEventPath,
  canScheduleChangeOrderEvents,
  describeEventLots,
  eventCreatedNotice,
  formatEventDay,
  isSchedulable,
  linesNeedingEvent,
  lotsByPlace,
} from '../services/changeOrderEventRecord.js'
import { deleteChangeOrderEvent } from '../services/changeOrderRepository.js'
import ChangeOrderEventDialog from './ChangeOrderEventDialog.jsx'

const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`
const lotWord = (text) => (/[,–]/.test(text) ? `Lots ${text}` : `Lot ${text}`)

function EventItem({ event, canWrite, canOpenCalendar, onEdit, onRemove }) {
  return (
    <Box
      component="li"
      sx={{
        p: 1.5,
        border: 1,
        borderColor: 'divider',
        borderLeft: 4,
        borderLeftColor: 'success.main',
        borderRadius: 1.5,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1.5,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
      }}
    >
      <Box sx={{ minWidth: 0, flex: '1 1 260px' }}>
        <Typography variant="body2" fontWeight={700}>{formatEventDay(event.date)}</Typography>
        <Typography variant="body2" color="text.secondary">{describeEventLots(event.lots)}</Typography>
        {event.note && (
          <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>{event.note}</Typography>
        )}
      </Box>
      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {canOpenCalendar && (
          <Button size="small" component={RouterLink} to={calendarEventPath(event.id)}>Open in Calendar</Button>
        )}
        {canWrite && <Button size="small" onClick={onEdit}>Change</Button>}
        {canWrite && <Button size="small" color="error" onClick={onRemove}>Remove</Button>}
      </Stack>
    </Box>
  )
}

/**
 * The events of their own of an Extra / CO, for the Lots that are not charged with an EXT, DM or HW event:
 * the ones scheduled, the Lots still waiting for one and, on an approved Extra / CO, "Schedule CO event".
 * Once an event is created the card says so, with a way to the Calendar and to tell Scheduling
 * (`onEmailScheduling`, when the person can).
 */
export default function ChangeOrderOwnEvents({ order, events, loading, error, onChanged, onEmailScheduling }) {
  const { profile } = useAuth()
  const canWrite = canScheduleChangeOrderEvents(profile?.role) && isSchedulable(order.status)
  const canOpenCalendar = canOpenPage(profile?.role, 'scheduling')
  const waiting = useMemo(() => linesNeedingEvent(order.lines, events), [order.lines, events])
  const places = order.lines.filter((line) => line.isPlace).length
  const [dialog, setDialog] = useState(null) // { kind: 'create' } | { kind: 'edit', event } | { kind: 'remove', event }
  // The id of the event just created: the notice reads it from the events once they are read again.
  const [createdId, setCreatedId] = useState(null)
  const created = createdId ? events.find((item) => item.id === createdId) ?? { id: createdId } : null
  const setCreated = setCreatedId
  const [notice, setNotice] = useState('')
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')

  const ownLots = order.lines.filter((line) => !line.isPlace && !line.billingEvent).length
  if (ownLots === 0 && places === 0) return null

  const closeDialog = () => {
    setDialog(null)
    setRemoveError('')
  }

  const afterSave = async (eventId, kind) => {
    setDialog(null)
    onChanged()
    if (kind === 'create') {
      setNotice('')
      setCreated(eventId)
    } else {
      setCreated(null)
      setNotice('The event was changed.')
    }
  }

  const remove = async () => {
    setRemoving(true)
    setRemoveError('')
    try {
      await deleteChangeOrderEvent(dialog.event.id)
      setRemoving(false)
      setDialog(null)
      setCreated(null)
      setNotice('The event was removed. Its Lots need an event again.')
      onChanged()
    } catch (failure) {
      setRemoving(false)
      setRemoveError(failure.message)
    }
  }

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 1 }}
      >
        <Box>
          <Typography variant="body2" fontWeight={700}>Own CO events</Typography>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
            Lots not charged with an EXT, DM or HW event get a date of their own on the Production Calendar.
          </Typography>
        </Box>
        {canWrite && waiting.length > 0 && (
          <Button
            size="small"
            variant="contained"
            disableElevation
            startIcon={<AddRoundedIcon />}
            onClick={() => {
              setNotice('')
              setDialog({ kind: 'create' })
            }}
            sx={{ flexShrink: 0 }}
          >
            Schedule CO event
          </Button>
        )}
      </Stack>

      {created && (
        <Alert
          severity="success"
          icon={<EventRoundedIcon />}
          onClose={() => setCreated(null)}
          sx={{ mb: 1.5 }}
          action={(
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              {canOpenCalendar && (
                <Button color="inherit" size="small" component={RouterLink} to={calendarEventPath(created.id)}>
                  Open in Calendar
                </Button>
              )}
              {onEmailScheduling && (
                <Button color="inherit" size="small" onClick={onEmailScheduling}>Email Scheduling</Button>
              )}
            </Stack>
          )}
        >
          {created.date ? eventCreatedNotice(created) : 'The CO event was created. It is on the Production Calendar.'}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 1.5 }}>{notice}</Alert>
      )}
      {error && <Alert severity="warning" sx={{ mb: 1.5 }}>{error}</Alert>}

      {loading ? (
        <Skeleton variant="rounded" height={64} />
      ) : (
        <Stack spacing={1.5}>
          {events.length > 0 && (
            <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }} aria-label="Scheduled CO events">
              {events.map((event) => (
                <EventItem
                  key={event.id}
                  event={event}
                  canWrite={canWrite}
                  canOpenCalendar={canOpenCalendar}
                  onEdit={() => {
                    setNotice('')
                    setDialog({ kind: 'edit', event })
                  }}
                  onRemove={() => setDialog({ kind: 'remove', event })}
                />
              ))}
            </Stack>
          )}

          {waiting.length > 0 && (
            <Box>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                {events.length > 0 ? 'Still to schedule' : 'To schedule'}
              </Typography>
              <Box
                component="dl"
                sx={{ m: 0, display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', columnGap: 2, rowGap: 0.5 }}
              >
                {lotsByPlace(waiting).map((item) => (
                  <Box key={item.place} sx={{ display: 'contents' }}>
                    <Typography component="dt" variant="body2" color="text.secondary">{item.place || 'Lots'}</Typography>
                    <Typography component="dd" variant="body2" fontWeight={600} sx={{ m: 0 }}>{lotWord(item.lots)}</Typography>
                  </Box>
                ))}
              </Box>
              {!isSchedulable(order.status) && order.status !== 'CANCELLED' && (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, mt: 0.75 }}>
                  They can be scheduled once the Extra / CO is approved.
                </Typography>
              )}
            </Box>
          )}

          {waiting.length === 0 && events.length > 0 && (
            <Typography variant="body2" color="success.main">Every Lot that needs one has its event.</Typography>
          )}

          {places > 0 && (
            <Typography variant="caption" color="text.secondary">
              {plural(places, 'line')} not on a lot: not scheduled on the Calendar.
            </Typography>
          )}
        </Stack>
      )}

      {dialog?.kind === 'create' && (
        <ChangeOrderEventDialog
          order={order}
          lines={waiting}
          onClose={closeDialog}
          onSaved={(eventId) => afterSave(eventId, 'create')}
        />
      )}
      {dialog?.kind === 'edit' && (
        <ChangeOrderEventDialog
          order={order}
          event={dialog.event}
          onClose={closeDialog}
          onSaved={(eventId) => afterSave(eventId, 'edit')}
        />
      )}
      <Dialog open={dialog?.kind === 'remove'} onClose={() => !removing && closeDialog()} maxWidth="xs" fullWidth>
        <DialogTitle>Remove this CO event?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {dialog?.kind === 'remove' && (
              `${formatEventDay(dialog.event.date)} · ${describeEventLots(dialog.event.lots)}. It leaves the Calendar and its Lots will need an event again.`
            )}
          </DialogContentText>
          {removeError && <Alert severity="error" sx={{ mt: 2 }}>{removeError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={closeDialog} disabled={removing}>Keep it</Button>
          <Button color="error" variant="contained" disableElevation onClick={remove} disabled={removing}>
            {removing ? 'Removing…' : 'Remove event'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
