import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'

import { useAuth } from '../../auth/context/useAuth.js'
import { canOpenPage } from '../../auth/authorization/roleAccess.js'
import ChangeOrderEventDialog, { DateLeaf } from '../../change-orders/components/ChangeOrderEventDialog.jsx'
import {
  canScheduleChangeOrderEvents,
  formatEventDay,
  todayKey,
} from '../../change-orders/services/changeOrderEventRecord.js'
import { deleteChangeOrderEvent } from '../../change-orders/services/changeOrderRepository.js'
import DrawerHeader from './DrawerHeader.jsx'

function Fact({ label, children }) {
  return (
    <Box sx={{ display: 'contents' }}>
      <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
      <Typography component="dd" variant="body2" fontWeight={600} sx={{ m: 0, minWidth: 0 }}>{children}</Typography>
    </Box>
  )
}

/**
 * What an event of its own of an Extra / CO shows when it is opened on the Production Calendar: the date,
 * the Extra / CO, the Job, the Lots and the note; the way to the Extra / CO, and, for the roles that
 * schedule them, changing its date and note or removing it. `onChanged(message)` runs after a change.
 */
export default function ChangeOrderEventPanel({ event, onClose, onChanged }) {
  const { profile } = useAuth()
  const canWrite = canScheduleChangeOrderEvents(profile?.role)
  const canOpenOrder = ['planning', 'drawInvoice', 'scheduling'].some((area) => canOpenPage(profile?.role, area))
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')

  if (!event) return null

  const remove = async () => {
    setRemoving(true)
    setError('')
    try {
      await deleteChangeOrderEvent(event.id)
      setRemoving(false)
      setConfirming(false)
      await onChanged('CO event removed from the Calendar. Its Lots need an event again.', { closed: true })
    } catch (failure) {
      setRemoving(false)
      setError(failure.message)
    }
  }

  return (
    <>
      <DrawerHeader eyebrow="EXTRA / CHANGE ORDER EVENT" title={event.changeOrderNumber} onClose={onClose} />

      <Box className="activity-drawer__scroll" sx={{ p: 3 }}>
        <Stack spacing={3}>
          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <DateLeaf date={event.date} today={todayKey()} />
            <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto', textAlign: 'right' }}>
              {formatEventDay(event.date)}
            </Typography>
          </Box>

          <Box
            component="dl"
            sx={{ m: 0, display: 'grid', gridTemplateColumns: 'minmax(90px, auto) 1fr', columnGap: 2, rowGap: 1 }}
          >
            <Fact label="Job">#{event.jobCode} · {event.community}</Fact>
            <Fact label="Builder">{event.builderName}</Fact>
            {event.poCoNumber && <Fact label="PO / CO #">{event.poCoNumber}</Fact>}
          </Box>

          {event.lots.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {event.lots.length === 1 ? '1 Lot' : `${event.lots.length} Lots`}
              </Typography>
              <Stack spacing={1.25}>
                {Array.from(
                  event.lots.reduce((byPlace, lot) => {
                    const place = [lot.phase && `Phase ${lot.phase}`, lot.building && `Building ${lot.building}`]
                      .filter(Boolean).join(', ')
                    byPlace.set(place, [...(byPlace.get(place) ?? []), lot])
                    return byPlace
                  }, new Map()),
                ).map(([place, lots]) => (
                  <Box key={place}>
                    {place && (
                      <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, mb: 0.5 }}>
                        {place}
                      </Typography>
                    )}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                      {lots.map((lot) => (
                        <Chip key={lot.lineId} size="small" variant="outlined" label={`Lot ${lot.lot}`} />
                      ))}
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}

          {event.lots.some((lot) => lot.scope) && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Scope of Work</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {[...new Set(event.lots.map((lot) => lot.scope).filter(Boolean))].map((scope) => (
                  <Typography component="li" variant="body2" key={scope}>{scope}</Typography>
                ))}
              </Box>
            </Box>
          )}

          {event.note && (
            <Box sx={{ pl: 1.5, borderLeft: 3, borderColor: 'divider' }}>
              <Typography variant="subtitle2" sx={{ mb: 0.25 }}>Note</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{event.note}</Typography>
            </Box>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          <Stack spacing={1}>
            {canWrite && (
              <Button variant="contained" disableElevation fullWidth onClick={() => setEditing(true)}>
                Change date or note
              </Button>
            )}
            <Stack direction="row" spacing={1} useFlexGap sx={{ justifyContent: 'space-between' }}>
              {canOpenOrder && (
                <Button variant="outlined" component={RouterLink} to={`/change-orders/${event.changeOrderId}`}>
                  Open {event.changeOrderNumber}
                </Button>
              )}
              {canWrite && <Button color="error" onClick={() => setConfirming(true)}>Remove event</Button>}
            </Stack>
          </Stack>
        </Stack>
      </Box>

      {editing && (
        <ChangeOrderEventDialog
          order={{ id: event.changeOrderId, number: event.changeOrderNumber }}
          event={event}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false)
            await onChanged('CO event changed.')
          }}
        />
      )}

      <Dialog open={confirming} onClose={() => !removing && setConfirming(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove this CO event?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {formatEventDay(event.date)} · {event.changeOrderNumber}. It leaves the Calendar and its Lots will need
            an event again.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setConfirming(false)} disabled={removing}>Keep it</Button>
          <Button color="error" variant="contained" disableElevation onClick={remove} disabled={removing}>
            {removing ? 'Removing…' : 'Remove event'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
