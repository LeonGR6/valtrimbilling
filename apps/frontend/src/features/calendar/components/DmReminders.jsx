import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { listDmReminders } from '../services/dmReminderRepository.js'
import {
  describeDmLots,
  describeDmStatus,
  formatDmDate,
  tomorrowInLosAngeles,
} from '../services/dmReminderRecord.js'
import DmReminderEmailDialog from './DmReminderEmailDialog.jsx'

function RecipientChip({ contact, role }) {
  return contact
    ? <Chip size="small" variant="outlined" label={`${role} · ${contact.name || contact.email}`} title={contact.email} />
    : <Chip size="small" color="warning" variant="outlined" label={`${role} · none`} />
}

/**
 * The normal DMs of a day (tomorrow by default), each with the email that tells the Job's
 * Supervisor and Project Manager about it. Nothing goes out until someone reviews the email,
 * chooses who gets it and sends it.
 */
export default function DmReminders() {
  const [date, setDate] = useState(() => tomorrowInLosAngeles())
  // What was loaded and for which request: a newer request (another date, a refresh)
  // makes the screen "loading" until its answer arrives.
  const [loaded, setLoaded] = useState({ key: null, data: null, error: '' })
  const [reloads, setReloads] = useState(0)
  const [notice, setNotice] = useState('')
  const [dismissedError, setDismissedError] = useState(null)
  const [reviewing, setReviewing] = useState(null)
  const requestKey = `${date}:${reloads}`

  useEffect(() => {
    let ignore = false
    listDmReminders(date)
      .then((data) => {
        if (!ignore) setLoaded({ key: requestKey, data, error: '' })
      })
      .catch((loadError) => {
        if (!ignore) setLoaded((current) => ({ ...current, key: requestKey, error: loadError.message }))
      })
    return () => {
      ignore = true
    }
  }, [date, requestKey])

  const refresh = () => setReloads((current) => current + 1)
  const loading = loaded.key !== requestKey
  const { data } = loaded
  const error = loaded.error && dismissedError !== loaded.key ? loaded.error : ''

  // The DMs of an earlier request are not shown under a new date while it loads.
  const events = loading ? [] : data?.events ?? []
  const tomorrow = tomorrowInLosAngeles()

  return (
    <Box className="builder-follow-up-queue">
      <Box className="builder-follow-up-queue__toolbar">
        <Box>
          <Typography variant="h6" fontWeight={780}>DM reminders</Typography>
          <Typography color="text.secondary" variant="body2">
            The day before a DM, the Job&apos;s Supervisor and Project Manager get its Sequence Sheet
            lots, without prices. Only normal DMs are announced.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          <TextField
            type="date"
            size="small"
            label="DM date"
            value={date}
            onChange={(event) => event.target.value && setDate(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Button
            color="inherit"
            disabled={date === tomorrow}
            onClick={() => setDate(tomorrow)}
          >
            Tomorrow
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={refresh}
            disabled={loading}
          >
            Refresh
          </Button>
        </Stack>
      </Box>

      {error && <Alert severity="error" onClose={() => setDismissedError(loaded.key)}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}

      {loading && (
        <Box className="builder-follow-up-queue__loading">
          <CircularProgress size={24} />
          <Typography color="text.secondary">Loading DMs…</Typography>
        </Box>
      )}

      {data && !loading && (
        <Typography variant="subtitle2" color="text.secondary">
          {events.length === 1 ? '1 DM' : `${events.length} DMs`} on {formatDmDate(data.date)}
        </Typography>
      )}

      {data && !loading && events.length === 0 && (
        <Box className="builder-follow-up-queue__empty">
          <Typography color="text.secondary">
            No normal DM is scheduled for {formatDmDate(data.date)}.
          </Typography>
        </Box>
      )}

      <Stack spacing={1.25}>
        {events.map((event) => {
          const status = describeDmStatus(event)
          return (
            <Paper
              key={event.scheduleId}
              variant="outlined"
              sx={{
                p: 2,
                display: 'flex',
                gap: 2,
                alignItems: { sm: 'center' },
                flexDirection: { xs: 'column', sm: 'row' },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontWeight={750}>
                  Job #{event.jobCode}
                  <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>
                    {' '}· {event.community} · {event.builderName}
                  </Typography>
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  Phase {event.phaseCode}
                  {/[A-Za-z0-9]/.test(event.building) ? ` · Building ${event.building}` : ''}
                  {' · '}
                  {describeDmLots(event)}
                </Typography>
                <Stack
                  direction="row"
                  spacing={0.75}
                  sx={{ mt: 1, flexWrap: 'wrap' }}
                  useFlexGap
                >
                  <RecipientChip contact={event.supervisor} role="Supervisor" />
                  <RecipientChip contact={event.projectManager} role="Project Manager" />
                </Stack>
              </Box>
              <Stack
                direction="row"
                spacing={1.25}
                sx={{ alignItems: 'center', flexShrink: 0 }}
              >
                <Chip size="small" color={status.color} variant={status.color === 'default' ? 'outlined' : 'filled'} label={status.label} />
                <Button
                  variant="contained"
                  disableElevation
                  startIcon={<EmailRoundedIcon />}
                  onClick={() => setReviewing(event)}
                >
                  Review email
                </Button>
              </Stack>
            </Paper>
          )
        })}
      </Stack>

      {reviewing && (
        <DmReminderEmailDialog
          event={reviewing}
          onClose={() => setReviewing(null)}
          onSent={(message) => {
            setReviewing(null)
            setNotice(message)
            refresh()
          }}
        />
      )}
    </Box>
  )
}
