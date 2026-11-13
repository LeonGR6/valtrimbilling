import {
  Alert,
  Box,
  Chip,
  FormControl,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'

import { getDateOwnerLabel } from '../../calendar/data/calendarEvents.js'
import {
  EVENT_CHOICES,
  EVENT_STATUS,
  businessDaysLeftText,
  eventChoiceLabel,
  formatEventDate,
  groupLotsByRecord,
  isCalendarEvent,
} from '../utils/calendarEvents.js'

// What each status says, in words (the color only helps).
const STATUS_CHIPS = {
  [EVENT_STATUS.AVAILABLE]: { label: 'Charged with it', color: 'success' },
  [EVENT_STATUS.TOO_CLOSE]: { label: 'Too close', color: 'warning' },
  [EVENT_STATUS.PASSED]: { label: 'Already passed', color: 'error' },
  [EVENT_STATUS.NOT_SCHEDULED]: { label: 'Not scheduled', color: 'default' },
  [EVENT_STATUS.OWN]: { label: 'Own CO event', color: 'info' },
}

/** What the Calendar says about the event chosen for one Lot. */
function eventLine(item) {
  const type = eventChoiceLabel(item.event)
  const date = formatEventDate(item.date)
  const owner = item.owner ? `${getDateOwnerLabel(item.owner, true)} date` : ''

  switch (item.status) {
    case EVENT_STATUS.OWN:
      return 'Will need an event of its own, scheduled once the Extra / CO is approved.'
    case EVENT_STATUS.AVAILABLE:
      return [`${type} on ${date}`, owner].filter(Boolean).join(' · ')
    case EVENT_STATUS.TOO_CLOSE:
      return `${type} on ${date} · ${businessDaysLeftText(item.businessDays)} · needs an event of its own`
    case EVENT_STATUS.PASSED:
      return `${type} was on ${date} · needs an event of its own`
    default:
      return item.date
        ? `${type} on ${date}`
        : `${type} is not on the Calendar · needs an event of its own`
  }
}

function EventSelect({ value, onChange, label, disabled, mixed = false }) {
  return (
    <FormControl size="small" sx={{ minWidth: 150 }} disabled={disabled}>
      <Select
        value={value}
        displayEmpty
        onChange={(event) => onChange(event.target.value)}
        SelectDisplayProps={{ 'aria-label': label }}
        renderValue={(selected) => (selected ? eventChoiceLabel(selected) : (mixed ? 'Mixed' : ''))}
      >
        {EVENT_CHOICES.map((choice) => (
          <MenuItem key={choice.value} value={choice.value}>
            <Box>
              <Typography variant="body2" fontWeight={600}>{choice.label}</Typography>
              <Typography variant="caption" color="text.secondary">{choice.description}</Typography>
            </Box>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}

function LotRow({ item, onChange }) {
  const chip = item.kept ? { label: 'Kept', color: 'info' } : STATUS_CHIPS[item.status]
  const lotLabel = `Lot ${item.row.lot}`

  return (
    <Box
      component="li"
      sx={{
        px: 2,
        py: 1,
        display: 'grid',
        gap: 1,
        alignItems: 'center',
        gridTemplateColumns: { xs: '1fr auto', md: '120px 170px minmax(0, 1fr) auto' },
        gridTemplateAreas: {
          xs: '"lot chip" "select select" "line line"',
          md: '"lot select line chip"',
        },
      }}
    >
      <Box sx={{ gridArea: 'lot', minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600}>{lotLabel}</Typography>
        {item.row.plan && (
          <Typography variant="caption" color="text.secondary">Plan {item.row.plan}</Typography>
        )}
      </Box>
      <Box sx={{ gridArea: 'select' }}>
        <EventSelect value={item.event} onChange={onChange} label={`Event of ${lotLabel}`} />
      </Box>
      <Box sx={{ gridArea: 'line', minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary">{eventLine(item)}</Typography>
        {item.kept && (
          <Typography variant="caption" color="info.main" component="p" sx={{ m: 0 }}>
            It was charged with this event when it was saved, so it stays charged.
          </Typography>
        )}
      </Box>
      <Chip sx={{ gridArea: 'chip', justifySelf: 'end' }} size="small" variant="outlined" label={chip.label} color={chip.color} />
    </Box>
  )
}

/**
 * Which event each Lot is charged with: an EXT, DM or HW event already on the Calendar, or an event of its
 * own (scheduled from the Extra / CO page once it is approved). There is a choice for every Lot, one for each
 * Plan with Specific Plan Types, and one for each Lot; each Lot shows what the Calendar says about its event.
 *
 * `plans` the Plans chosen (Specific Plan Types only) with the
 * event each follows; `evaluations` one per Lot (see `evaluateLots`). `onPlan(planId, event)` and `onLots(lotIds, event)` change them.
 */
export default function ChangeOrderEventCard({
  plans = [],
  evaluations,
  summary,
  hasJob,
  loading,
  error,
  onPlan,
  onLots,
}) {
  const hasLots = evaluations.length > 0
  const usesCalendar = evaluations.some((item) => isCalendarEvent(item.event))
  const groups = groupLotsByRecord(evaluations)

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {hasJob
          ? 'Choose the event of each phase, Plan or Lot below. A Lot is charged with its EXT, DM or HW event when more than 5 business days are left before it; if not, it needs an event of its own.'
          : 'Choose the Job first.'}
      </Typography>

      {plans.length > 0 && (
        <Box sx={{ mt: 2.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>By Plan</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            The Lots of a Plan added later follow its event too.
          </Typography>
          <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {plans.map((plan) => (
              <Box
                component="li"
                key={plan.id}
                sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, justifyContent: 'space-between' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700}>Plan {plan.code}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {[plan.name, `${plan.lots} ${plan.lots === 1 ? 'lot' : 'lots'} today`].filter(Boolean).join(', ')}
                  </Typography>
                </Box>
                <EventSelect value={plan.event} onChange={(value) => onPlan(plan.id, value)} label={`Event of Plan ${plan.code}`} />
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      {hasJob && !hasLots && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Choose the lots first to see where their events are.
        </Typography>
      )}

      {hasLots && usesCalendar && loading && (
        <Stack spacing={1} sx={{ mt: 2 }} role="status" aria-live="polite">
          <Typography variant="body2" color="text.secondary">Reading the Calendar…</Typography>
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={56} />
        </Stack>
      )}

      {hasLots && usesCalendar && !loading && error && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {error} Reload the page to try again, or set the Lots to Own CO event to go on without the Calendar.
        </Alert>
      )}

      {hasLots && !(usesCalendar && (loading || error)) && (
        <Box sx={{ mt: 2.5 }}>
          <Typography variant="body2" fontWeight={600} role="status" aria-live="polite" sx={{ mb: 1.5 }}>
            {summary.linked} of {summary.total} {summary.total === 1 ? 'lot' : 'lots'} charged with a Calendar event
            {summary.own > 0 && (
              <Typography component="span" variant="body2" color="text.secondary" fontWeight={400}>
                {' '}· {summary.own} will need an event of {summary.own === 1 ? 'its' : 'their'} own
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
                <Box
                  sx={{
                    px: 2,
                    py: 1,
                    bgcolor: 'action.hover',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                  }}
                >
                  <Typography variant="subtitle2">{group.label}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary">All {group.items.length} lots</Typography>
                    <EventSelect
                      value={group.event}
                      mixed
                      onChange={(value) => onLots(group.items.map((item) => item.row.lotId), value)}
                      label={`Event of every Lot of ${group.label}`}
                    />
                  </Box>
                </Box>
                <Box
                  component="ul"
                  sx={{ m: 0, p: 0, listStyle: 'none', '& > li + li': { borderTop: 1, borderColor: 'divider' } }}
                >
                  {group.items.map((item) => (
                    <LotRow key={item.row.lotId} item={item} onChange={(value) => onLots([item.row.lotId], value)} />
                  ))}
                </Box>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  )
}
