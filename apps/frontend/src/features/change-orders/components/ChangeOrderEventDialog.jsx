import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

import DateField from '../../../components/common/DateField.jsx'
import {
  describeEventLots,
  eventProblems,
  formatEventDay,
  maxEventNoteLength,
  todayKey,
  toCreateEventRpc,
  toUpdateEventRpc,
} from '../services/changeOrderEventRecord.js'
import { createChangeOrderEvent, updateChangeOrderEvent } from '../services/changeOrderRepository.js'

const placeLabel = (line) => [
  line.phase && `Phase ${line.phase}`,
  line.building && `Building ${line.building}`,
].filter(Boolean).join(', ') || 'Lots'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The date as the Calendar will show it: a calendar leaf with the month, the day and how far away it is. */
export function DateLeaf({ date, today }) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : null
  const valid = parsed && !Number.isNaN(parsed.getTime())
  const days = valid ? Math.round((parsed - new Date(`${today}T00:00:00`)) / 86400000) : null
  const past = valid && days < 0
  const distance = !valid ? '' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days > 1 ? `In ${days} days` : 'Already passed'

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}
    >
      <Box
        aria-hidden
        sx={{
          width: 64,
          flex: 'none',
          borderRadius: 1.5,
          overflow: 'hidden',
          border: 1,
          borderColor: valid ? (past ? 'error.main' : 'primary.main') : 'divider',
          borderStyle: valid ? 'solid' : 'dashed',
          textAlign: 'center',
          bgcolor: 'background.paper',
        }}
      >
        <Box
          sx={{
            py: 0.25,
            bgcolor: valid ? (past ? 'error.main' : 'primary.main') : 'action.hover',
            color: valid ? 'common.white' : 'text.disabled',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.6,
          }}
        >
          {valid ? MONTHS[parsed.getMonth()] : '—'}
        </Box>
        <Box sx={{ py: 0.5, fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: valid ? 'text.primary' : 'text.disabled' }}>
          {valid ? parsed.getDate() : '··'}
        </Box>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600}>
          {valid ? WEEKDAYS[parsed.getDay()] : 'No date yet'}
        </Typography>
        <Typography variant="caption" color={past ? 'error.main' : 'text.secondary'}>
          {valid ? distance : 'It shows here once you pick it'}
        </Typography>
      </Box>
    </Box>
  )
}

/** The Lots that can go in the event, by Phase / Building, each Phase / Building with a box for all of it. */
function LotPicker({ lines, chosen, onChange, error }) {
  const places = useMemo(() => {
    const byPlace = new Map()
    for (const line of lines) {
      const label = placeLabel(line)
      if (!byPlace.has(label)) byPlace.set(label, [])
      byPlace.get(label).push(line)
    }
    return [...byPlace.entries()]
  }, [lines])

  const toggle = (ids, on) => {
    const next = new Set(chosen)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    onChange(next)
  }

  return (
    <Box component="fieldset" sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 0.75 }}>
        <Typography component="legend" variant="subtitle2" sx={{ p: 0 }}>
          Lots in this event
        </Typography>
        <Typography variant="caption" color={chosen.size === 0 ? 'error.main' : 'text.secondary'} aria-live="polite">
          {chosen.size} of {lines.length} chosen
        </Typography>
      </Box>
      {error && <Typography variant="caption" color="error" component="p" sx={{ m: 0, mb: 0.5 }}>{error}</Typography>}
      <Stack
        divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}
        sx={{
          maxHeight: 280,
          overflowY: 'auto',
          border: 1,
          borderColor: error ? 'error.main' : 'divider',
          borderRadius: 1.5,
        }}
      >
        {places.map(([label, placeLines]) => {
          const ids = placeLines.map((line) => String(line.id))
          const count = ids.filter((id) => chosen.has(id)).length
          return (
            <Box key={label} sx={{ px: 1.5, py: 1 }}>
              <FormControlLabel
                sx={{ m: 0, mb: 0.5 }}
                label={(
                  <Typography variant="body2" fontWeight={700}>
                    {label}
                    <Typography component="span" variant="caption" color="text.secondary" fontWeight={400}>
                      {' '}· {count} of {ids.length}
                    </Typography>
                  </Typography>
                )}
                control={(
                  <Checkbox
                    size="small"
                    checked={count === ids.length}
                    indeterminate={count > 0 && count < ids.length}
                    onChange={(event) => toggle(ids, event.target.checked)}
                    slotProps={{ input: { 'aria-label': `Every Lot of ${label}` } }}
                  />
                )}
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, pl: 0.5 }}>
                {placeLines.map((line) => {
                  const on = chosen.has(String(line.id))
                  return (
                    <Chip
                      key={line.id}
                      size="small"
                      clickable
                      label={`Lot ${line.lot}`}
                      color={on ? 'primary' : 'default'}
                      variant={on ? 'filled' : 'outlined'}
                      onClick={() => toggle([String(line.id)], !on)}
                      aria-pressed={on}
                      aria-label={`Lot ${line.lot}, ${label}`}
                    />
                  )
                })}
              </Box>
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}

/**
 * Creates an event of its own for Lots of an approved Extra / CO (`lines`: the Lots that still need one,
 * all ticked to start with), or changes the date and note of one (`event`). `onSaved(eventId)` runs after it
 * was saved; a refusal of the database is shown inside the dialog.
 */
export default function ChangeOrderEventDialog({ order, lines = [], event = null, onClose, onSaved }) {
  const creating = !event
  const [values, setValues] = useState(() => ({
    date: event?.date ?? '',
    note: event?.note ?? '',
  }))
  const [chosen, setChosen] = useState(() => new Set(lines.map((line) => String(line.id))))
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const today = todayKey()
  const problems = eventProblems(
    { ...values, lineIds: [...chosen] },
    { creating, today, savedDate: event?.date ?? '' },
  )
  const shown = attempted ? problems : []
  const problemOf = (field) => shown.find((problem) => problem.field === field)?.message ?? ''

  // What saving will do, in one line next to the buttons.
  const chosenLines = creating ? lines.filter((line) => chosen.has(String(line.id))) : (event?.lots ?? [])
  const summary = [
    chosenLines.length > 0 ? describeEventLots(chosenLines) : creating ? 'No Lots chosen' : '',
    values.date ? formatEventDay(values.date) : '',
  ].filter(Boolean).join(' · ')

  const close = () => {
    if (!saving) onClose()
  }

  const save = async () => {
    setAttempted(true)
    if (problems.length > 0 || saving) return
    setSaving(true)
    setError('')
    try {
      let eventId = event?.id
      if (creating) {
        // The order of the lines, as on the Extra / CO.
        const lineIds = lines.map((line) => String(line.id)).filter((id) => chosen.has(id))
        eventId = await createChangeOrderEvent(toCreateEventRpc(order.id, { ...values, lineIds }))
      } else {
        await updateChangeOrderEvent(toUpdateEventRpc(event.id, values))
      }
      setSaving(false)
      await onSaved(eventId)
    } catch (failure) {
      setSaving(false)
      setError(failure.message)
    }
  }

  return (
    <Dialog open onClose={close} fullWidth maxWidth="sm" scroll="paper" aria-labelledby="change-order-event-title">
      <form
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault()
          save()
        }}
        noValidate
      >
        <DialogTitle id="change-order-event-title" sx={{ pb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, fontWeight: 600 }}>
            {order.number}
          </Typography>
          {creating ? 'Schedule CO event' : 'Change the CO event'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            {creating
              ? 'It goes on the Production Calendar for the Lots below, which are not charged with an EXT, DM or HW event.'
              : 'Only the date and the note change. Its Lots stay as they are.'}
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <Stack spacing={3}>
            <Box>
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 2,
                }}
              >
                <DateField
                  size="small"
                  label="Date"
                  value={values.date}
                  onChange={(date) => setValues((current) => ({ ...current, date }))}
                  error={Boolean(problemOf('date'))}
                  helperText={problemOf('date') || 'mm/dd/yyyy'}
                  sx={{ width: 200 }}
                />
                <DateLeaf date={values.date} today={today} />
              </Box>
            </Box>

            {creating && (
              <LotPicker lines={lines} chosen={chosen} onChange={setChosen} error={problemOf('lines')} />
            )}

            <TextField
              multiline
              minRows={2}
              maxRows={6}
              size="small"
              label="Note (optional)"
              placeholder="What the crew needs to know"
              value={values.note}
              onChange={(change) => setValues((current) => ({ ...current, note: change.target.value }))}
              error={Boolean(problemOf('note'))}
              helperText={problemOf('note') || `${values.note.trim().length} / ${maxEventNoteLength}`}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0, flex: '1 1 180px' }}>
            {summary}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button color="inherit" onClick={close} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="contained" disableElevation disabled={saving}>
              {saving ? 'Saving…' : creating ? 'Create event' : 'Save changes'}
            </Button>
          </Box>
        </DialogActions>
      </form>
    </Dialog>
  )
}
