import {
  Alert,
  Box,
  Chip,
  Divider,
  FormControlLabel,
  Radio,
  RadioGroup,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'

import { getDateOwnerLabel } from '../../calendar/data/calendarEvents.js'
import { OWN_EVENT } from '../data/changeOrders.js'
import {
  CHARGE_EVENTS,
  EVENT_STATUS,
  businessDaysLeftText,
  formatEventDate,
} from '../utils/calendarEvents.js'

const OPTIONS = [
  ...CHARGE_EVENTS,
  { value: OWN_EVENT, label: 'Own CO event', description: 'Scheduled apart, in the CO calendar' },
]

// What each status says, in words (the color only helps): the chip, and the line that explains it.
const STATUS_CHIPS = {
  [EVENT_STATUS.AVAILABLE]: { label: 'Available', color: 'success' },
  [EVENT_STATUS.TOO_CLOSE]: { label: 'Too close', color: 'warning' },
  [EVENT_STATUS.PASSED]: { label: 'Already passed', color: 'error' },
  [EVENT_STATUS.NOT_SCHEDULED]: { label: 'Not scheduled', color: 'default' },
}

const lotsLabel = (part) => `${part.count === 1 ? 'Lot' : 'Lots'} ${part.lotText}`

/** The date line of one stretch of lots: what the Calendar says about the event for them. */
function eventLine(part, type) {
  const date = formatEventDate(part.date)
  const owner = part.owner ? `${getDateOwnerLabel(part.owner, true)} date` : ''

  switch (part.status) {
    case EVENT_STATUS.AVAILABLE:
      return [`${type} on ${date}`, owner].filter(Boolean).join(' · ')
    case EVENT_STATUS.TOO_CLOSE:
      return `${type} on ${date} · ${businessDaysLeftText(part.businessDays)}`
    case EVENT_STATUS.PASSED:
      return `${type} was on ${date}`
    default:
      return `${type} is not on the Calendar`
  }
}

function EventPart({ part, type }) {
  const chip = part.kept ? { label: 'Kept', color: 'info' } : STATUS_CHIPS[part.status]
  const note = part.kept
    ? 'It was charged with this event when it was saved, so it stays charged.'
    : part.linked ? '' : 'Needs an event in the CO calendar.'

  return (
    <Box
      sx={{
        px: 2,
        py: 1.25,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        columnGap: 2,
        rowGap: 0.75,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600}>{lotsLabel(part)}</Typography>
        <Typography variant="body2" color="text.secondary">
          {part.date || part.status !== EVENT_STATUS.NOT_SCHEDULED
            ? eventLine(part, type)
            : `${type} is not on the Calendar`}
        </Typography>
        {note && (
          <Typography variant="caption" color={part.kept ? 'info.main' : 'text.secondary'} component="p" sx={{ m: 0, mt: 0.25 }}>
            {note}
          </Typography>
        )}
      </Box>
      <Chip size="small" variant="outlined" label={chip.label} color={chip.color} />
    </Box>
  )
}

/**
 * Whether the lots are charged with an event that is already on the Calendar (EXT, DM or HW), or each
 * needs an event of its own in the Extra / CO calendar. With an event chosen, each Phase / Building
 * shows that event's date for its lots and whether it can still be charged along with.
 */
export default function ChangeOrderEventCard({
  chargeEvent,
  onChange,
  hasJob,
  hasLots,
  loading,
  error,
  groups,
  summary,
}) {
  const choosing = chargeEvent !== OWN_EVENT
  const option = OPTIONS.find((item) => item.value === chargeEvent)

  return (
    <Box>
      <RadioGroup
        row
        value={chargeEvent}
        onChange={(event) => onChange({ chargeEvent: event.target.value })}
        aria-label="Charge with"
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' },
        }}
      >
        {OPTIONS.map((item) => (
          <FormControlLabel
            key={item.value}
            value={item.value}
            disabled={!hasJob}
            control={<Radio size="small" />}
            label={(
              <Box>
                <Typography variant="body2" fontWeight={700}>{item.label}</Typography>
                <Typography variant="caption" color="text.secondary">{item.description}</Typography>
              </Box>
            )}
            sx={{
              m: 0,
              px: 1,
              py: 0.75,
              border: 1,
              borderRadius: 1.5,
              alignItems: 'flex-start',
              borderColor: chargeEvent === item.value ? 'primary.main' : 'divider',
              bgcolor: chargeEvent === item.value ? 'action.selected' : 'transparent',
              '& .MuiRadio-root': { pt: 0.75 },
            }}
          />
        ))}
      </RadioGroup>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        {!hasJob && 'Choose the Job first.'}
        {hasJob && !choosing
          && 'Each lot will need an event of its own in the Extra / CO calendar.'}
        {hasJob && choosing
          && `A lot is charged with its ${option.label} event when more than 5 business days are left before it. If not, it needs an event of its own in the Extra / CO calendar.`}
      </Typography>

      {hasJob && choosing && !hasLots && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Choose the lots first to see where their {option.label} event is.
        </Typography>
      )}

      {hasJob && choosing && hasLots && loading && (
        <Stack spacing={1} sx={{ mt: 2 }} role="status" aria-live="polite">
          <Typography variant="body2" color="text.secondary">Reading the Calendar…</Typography>
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={56} />
        </Stack>
      )}

      {hasJob && choosing && hasLots && !loading && error && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {error} Reload the page to try again, or choose Own CO event to go on without the Calendar.
        </Alert>
      )}

      {hasJob && choosing && hasLots && !loading && !error && groups.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" fontWeight={600} role="status" aria-live="polite" sx={{ mb: 1.5 }}>
            {summary.linked} of {summary.total} {summary.total === 1 ? 'lot' : 'lots'} will be charged with {option.label}
            {summary.own > 0 && (
              <Typography component="span" variant="body2" color="text.secondary" fontWeight={400}>
                {' '}· {summary.own} will need an event of {summary.own === 1 ? 'its' : 'their'} own in the CO calendar
              </Typography>
            )}
          </Typography>

          <Stack component="ul" spacing={1.5} sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {groups.map((group) => (
              <Box
                component="li"
                key={group.key}
                sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}
              >
                <Typography variant="subtitle2" sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}>
                  {group.label}
                </Typography>
                <Stack divider={<Divider />}>
                  {group.parts.map((part) => (
                    <EventPart key={part.key} part={part} type={option.label} />
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  )
}
