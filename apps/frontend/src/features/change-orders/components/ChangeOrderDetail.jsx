import { useMemo, useState } from 'react'
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Link,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined'
import ViewAgendaOutlinedIcon from '@mui/icons-material/ViewAgendaOutlined'
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined'

import {
  CatalogEmptyState,
  CatalogPageHeader,
  catalogTableSx,
} from '../../../components/common/CatalogPage'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { useAuth } from '../../auth/context/useAuth.js'
import { canOpenPage } from '../../auth/authorization/roleAccess.js'
import { allChangeOrderStatuses } from '../data/changeOrders.js'
import { useChangeOrder, useSchedulingEmails } from '../hooks/useChangeOrderData.js'
import { canTellScheduling, describeEmailHistory } from '../services/changeOrderEmailRecord.js'
import {
  canEditChangeOrders,
  canSetPoCoNumber,
  groupDetailEvents,
  groupDetailLines,
  summarizeDetailLines,
} from '../services/changeOrderRecord.js'
import { formatEventDate } from '../utils/calendarEvents.js'
import ChangeOrderActions from './ChangeOrderActions.jsx'
import ChangeOrderInvoiceButton from './ChangeOrderInvoiceButton.jsx'
import ChangeOrderStatusChip from './ChangeOrderStatusChip.jsx'
import PoCoNumberDialog from './PoCoNumberDialog.jsx'
import SchedulingEmailDialog from './SchedulingEmailDialog.jsx'

const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`

const LIST = { label: 'Extra / Change Orders', to: '/change-orders' }

// The colour of a status in the history; Draft has none of its own.
const STATUS_COLORS = {
  DRAFT: 'text.disabled',
  PENDING: 'warning.main',
  APPROVED: 'success.main',
  CANCELLED: 'error.main',
}

const money = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

/** "3 lots and 2 lines without a lot" */
function countsText({ lots, places }) {
  return [
    lots > 0 && plural(lots, 'lot'),
    places > 0 && `${plural(places, 'line')} without a lot`,
  ].filter(Boolean).join(' and ')
}

/**
 * Who asked and when: one row under the number, only what was written. The PO / CO # is the exception:
 * whoever may write it sees it even when empty, with the button to add or change it (it often arrives
 * after the Extra / CO was approved).
 */
function Facts({ order, onEditPoCo }) {
  const facts = [
    { label: 'Builder', value: order.builderName },
    { label: 'Community', value: order.community },
    { label: 'Job', value: order.jobCode ? `#${order.jobCode}` : '' },
    { label: 'PO / CO #', value: order.poCoNumber, onEdit: onEditPoCo },
    { label: 'Requested by', value: order.requestedBy },
    { label: 'Requested on', value: order.requestDate ? formatDate(order.requestDate) : '' },
    { label: 'Needed by', value: order.neededByDate ? formatDate(order.neededByDate) : '' },
    // The CO number is the internal one unless the office wrote its own.
    {
      label: 'Internal #',
      value: order.internalNumber && order.internalNumber !== order.number ? order.internalNumber : '',
    },
    // Made from a Package: the Extra / CO it charges for, and the Package that billed its Lots.
    {
      label: 'Charged for',
      value: order.sourceNumber,
      to: order.sourceChangeOrderId ? `/change-orders/${order.sourceChangeOrderId}` : '',
    },
    { label: 'From Package', value: order.sourcePackageNumber },
  ].filter((fact) => fact.value || fact.onEdit)

  return (
    <Box
      component="dl"
      aria-label="Who asked and when"
      sx={{ m: 0, mt: 2, display: 'flex', flexWrap: 'wrap', columnGap: { xs: 3, md: 5 }, rowGap: 1.5 }}
    >
      {facts.map((fact) => (
        <Box key={fact.label} sx={{ minWidth: 0 }}>
          <Typography component="dt" variant="caption" color="text.secondary">
            {fact.label}
          </Typography>
          <Typography
            component="dd"
            variant="body2"
            fontWeight={600}
            sx={{ m: 0, overflowWrap: 'anywhere', display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              {fact.to
                ? <Link component={RouterLink} to={fact.to} fontWeight={600}>{fact.value}</Link>
                : fact.value || <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400 }}>Not written yet</Box>}
            </Box>
            {fact.onEdit && (
              // The button never shrinks: a long number wraps instead, so "Change" is not cut in two.
              <Button
                size="small"
                onClick={fact.onEdit}
                aria-label={`${fact.value ? 'Change' : 'Add'} ${fact.label}`}
                sx={{ minWidth: 0, flexShrink: 0, whiteSpace: 'nowrap', px: 0.75, py: 0, fontWeight: 600 }}
              >
                {fact.value ? 'Change' : 'Add'}
              </Button>
            )}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

function Row({ label, children }) {
  return (
    <>
      <Typography component="dt" variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography component="dd" variant="body2" fontWeight={600} sx={{ m: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </>
  )
}

/** One piece of work: what is done, what each lot is charged and where. */
function WorkGroup({ work }) {
  const planText = work.plans.map(({ plan, count }) => `Plan ${plan} on ${plural(count, 'lot')}`).join(', ')

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 3, rowGap: 1 }}>
      <Typography variant="body1" fontWeight={600} sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {work.scope || <Box component="span" sx={{ color: 'text.disabled' }}>No Scope of Work</Box>}
      </Typography>
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="body1" fontWeight={700} sx={money}>
          {formatCurrency(work.subtotal)}
        </Typography>
        {work.count > 1 && (
          <Typography variant="caption" color="text.secondary" sx={money} component="div">
            {formatCurrency(work.amount)} × {work.count}
          </Typography>
        )}
      </Box>

      <Box sx={{ gridColumn: '1 / -1' }}>
        <Box
          component="dl"
          sx={{ m: 0, display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', columnGap: 2, rowGap: 0.5 }}
        >
          {work.locations.map((spot) => (
            <Row key={`${spot.phase}-${spot.building}`} label={[
              spot.phase && `Phase ${spot.phase}`,
              spot.building && `Building ${spot.building}`,
            ].filter(Boolean).join(', ') || 'Lots'}
            >
              {/[,–]/.test(spot.lots) ? `Lots ${spot.lots}` : `Lot ${spot.lots}`}
            </Row>
          ))}
        </Box>
        {planText && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>
            {planText}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

/** A line that is not on a lot: the Sales Office, a restroom. */
function PlaceGroup({ place }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 3, rowGap: 1 }}>
      <Typography variant="body1" fontWeight={600} sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {place.scope}
      </Typography>
      <Typography variant="body1" fontWeight={700} sx={money}>
        {formatCurrency(place.amount)}
      </Typography>
      <Box
        component="dl"
        sx={{
          gridColumn: '1 / -1',
          m: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(120px, auto) 1fr',
          columnGap: 2,
        }}
      >
        <Row label="Not on a lot">{place.location}</Row>
      </Box>
    </Box>
  )
}

/** "Phase 2, Building 1", or "Lots" when the Job has neither. */
const spotLabel = (spot) => [
  spot.phase && `Phase ${spot.phase}`,
  spot.building && `Building ${spot.building}`,
].filter(Boolean).join(', ') || 'Lots'

const lotsText = (lots) => (/[,–]/.test(lots) ? `Lots ${lots}` : `Lot ${lots}`)

/**
 * Which Calendar event the lots are charged with (and the date it had when it was saved), and which
 * lots have none and need an event of their own in the Extra / CO calendar.
 */
function EventCard({ order }) {
  const { profile } = useAuth()
  const { ties, own } = useMemo(() => groupDetailEvents(order.lines), [order.lines])
  const needsOwn = own.spots.length > 0 || own.places > 0
  const hasTies = ties.length > 0
  // Scheduling is told about the lots charged with an event, once the Extra / CO is more than a Draft.
  const canSend = hasTies && canEditChangeOrders(profile?.role) && canTellScheduling(order.status)
  const { emails, refresh: refreshEmails } = useSchedulingEmails(order.id, hasTies)
  const [asking, setAsking] = useState(false)
  const [sentMessage, setSentMessage] = useState('')
  if (!hasTies && !needsOwn) return null

  const history = describeEmailHistory(emails, formatDateTime)

  return (
    <Paper variant="outlined" component="section" aria-label="Calendar event" sx={{ p: 2.5, borderRadius: 2 }}>
      <Typography variant="subtitle1" component="h2" fontWeight={700} sx={{ mb: 1.5 }}>
        Calendar event
      </Typography>

      <Stack spacing={2}>
        {ties.map(({ event, spots }) => (
          <Box key={event}>
            <Typography variant="body2" fontWeight={700} sx={{ mb: 0.75 }}>
              Charged with {event}
            </Typography>
            <Box
              component="dl"
              sx={{ m: 0, display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', columnGap: 2, rowGap: 0.5 }}
            >
              {spots.map((spot) => (
                <Row key={`${spot.phase}-${spot.building}-${spot.date}`} label={spotLabel(spot)}>
                  {lotsText(spot.lots)}
                  <Typography component="span" variant="body2" color="text.secondary" fontWeight={400}>
                    {' '}· {event} on {formatEventDate(spot.date)}
                  </Typography>
                </Row>
              ))}
            </Box>
          </Box>
        ))}

        {needsOwn && (
          <Box>
            <Typography variant="body2" fontWeight={700} sx={{ mb: 0.25 }}>
              Own CO event
            </Typography>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, mb: 0.75 }}>
              Not tied to the Calendar: these need an event in the Extra / CO calendar.
            </Typography>
            <Box
              component="dl"
              sx={{ m: 0, display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', columnGap: 2, rowGap: 0.5 }}
            >
              {own.spots.map((spot) => (
                <Row key={`${spot.phase}-${spot.building}`} label={spotLabel(spot)}>
                  {lotsText(spot.lots)}
                </Row>
              ))}
              {own.places > 0 && (
                <Row label="Not on a lot">{plural(own.places, 'line')}</Row>
              )}
            </Box>
          </Box>
        )}
      </Stack>

      {hasTies && (
        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
              {history
                || (canTellScheduling(order.status)
                  ? 'Scheduling has not been told about these lots yet.'
                  : 'Scheduling can be told once this is Pending or Approved.')}
            </Typography>
            {canSend && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<EmailOutlinedIcon />}
                onClick={() => {
                  setSentMessage('')
                  setAsking(true)
                }}
                sx={{ flexShrink: 0 }}
              >
                {emails.length > 0 ? 'Email Scheduling again' : 'Email Scheduling'}
              </Button>
            )}
          </Stack>
          {sentMessage && (
            <Alert severity="success" onClose={() => setSentMessage('')} sx={{ mt: 1.5 }}>
              {sentMessage}
            </Alert>
          )}
        </Box>
      )}

      {asking && (
        <SchedulingEmailDialog
          changeOrderId={order.id}
          onClose={() => setAsking(false)}
          onSent={(message) => {
            setAsking(false)
            setSentMessage(message)
            refreshEmails()
          }}
        />
      )}
    </Paper>
  )
}

function LinesTable({ order, totals }) {
  return (
    <TableContainer>
      <Table size="small" aria-label="Every line" sx={[{ minWidth: 1000 }, catalogTableSx]}>
        <TableHead>
          <TableRow>
            <TableCell width={48}>#</TableCell>
            <TableCell>Phase</TableCell>
            <TableCell>Building</TableCell>
            <TableCell>Lot / Place</TableCell>
            <TableCell>Plan Type</TableCell>
            <TableCell sx={{ minWidth: 260 }}>Scope of Work</TableCell>
            <TableCell>Charged with</TableCell>
            <TableCell>PO</TableCell>
            <TableCell align="right">Amount</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {order.lines.map((line) => (
            <TableRow key={line.id} hover>
              <TableCell>{line.lineNumber}</TableCell>
              <TableCell>{line.phase || '—'}</TableCell>
              <TableCell>{line.building || '—'}</TableCell>
              <TableCell>
                {line.isPlace ? (
                  <>
                    <Typography variant="body2" fontWeight={600}>{line.location}</Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      No lot
                    </Typography>
                  </>
                ) : line.lot}
              </TableCell>
              <TableCell>{line.plan ? `Plan ${line.plan}` : '—'}</TableCell>
              <TableCell sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{line.scope}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {line.billingEvent
                  ? `${line.billingEvent} · ${formatDate(line.billingEventDate)}`
                  : <Box component="span" sx={{ color: 'text.secondary' }}>Own CO event</Box>}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{line.poNumber || '—'}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                {formatCurrency(line.amount)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={8} align="right" sx={{ fontWeight: 700 }}>Total</TableCell>
            <TableCell align="right" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
              {formatCurrency(totals.total)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  )
}

/**
 * What is charged. By default the lines are read as the work they are (the same work on many lots is
 * said once); "Every line" is the full list, one row per lot, with the PO of each.
 */
function WorkCard({ order, totals }) {
  const [view, setView] = useState('work')
  const { works, places } = useMemo(() => groupDetailLines(order.lines), [order.lines])
  const pieces = works.length + places.length

  return (
    <Paper variant="outlined" component="section" aria-label="Work" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Stack
        direction="row"
        useFlexGap
        spacing={2}
        sx={{ px: { xs: 2, md: 3 }, py: 2, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Box>
          <Typography variant="subtitle1" component="h2" fontWeight={700}>
            Work
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {view === 'work'
              ? `${plural(pieces, 'piece')} of work, ${countsText(totals)}`
              : countsText(totals)}
          </Typography>
        </Box>
        {/* Two ways to read the same lines: drawn as a control (outlined, the chosen one filled), not as a tab strip. */}
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary" component="span" aria-hidden>
            View
          </Typography>
          <ToggleButtonGroup
            exclusive
            value={view}
            onChange={(_, next) => next && setView(next)}
            aria-label="How to read the lines"
            sx={{
              '& .MuiToggleButton-root': {
                textTransform: 'none',
                fontWeight: 600,
                px: 2,
                py: 0.75,
                gap: 0.75,
                color: 'primary.main',
                borderColor: 'primary.main',
                '&:hover': { bgcolor: 'primary.light' },
                '&.Mui-selected, &.Mui-selected:hover': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                },
                '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 },
              },
            }}
          >
            <ToggleButton value="work">
              <ViewAgendaOutlinedIcon fontSize="small" />
              By work
            </ToggleButton>
            <ToggleButton value="lines">
              <TableRowsOutlinedIcon fontSize="small" />
              Every line
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>

      {view === 'work' ? (
        <Stack
          component="ul"
          divider={<Box component="li" aria-hidden sx={{ borderTop: 1, borderColor: 'divider', listStyle: 'none' }} />}
          sx={{ m: 0, p: 0, listStyle: 'none', borderTop: 1, borderColor: 'divider' }}
        >
          {works.map((work) => (
            <Box component="li" key={work.key} sx={{ px: { xs: 2, md: 3 }, py: 2.25 }}>
              <WorkGroup work={work} />
            </Box>
          ))}
          {places.map((place) => (
            <Box component="li" key={place.id} sx={{ px: { xs: 2, md: 3 }, py: 2.25 }}>
              <PlaceGroup place={place} />
            </Box>
          ))}
        </Stack>
      ) : (
        <LinesTable order={order} totals={totals} />
      )}
    </Paper>
  )
}

/**
 * The Scope and Amount of each Plan of a "Specific Plan Types" Extra / CO: what its Lots were priced with
 * and, once approved, what a Lot of those Plans added later is charged with.
 */
function PlanRulesCard({ order }) {
  const approved = order.status === 'APPROVED'

  return (
    <Paper variant="outlined" component="section" aria-label="Scope and Amount by Plan" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
        <Typography variant="subtitle1" component="h2" fontWeight={700}>
          Scope and Amount by Plan
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {order.status === 'CANCELLED'
            ? 'It was cancelled: Lots of these Plans added later are no longer charged.'
            : approved
              ? 'A Lot of these Plans added to the Job later is charged with these, from the first Package that bills it.'
              : 'Once approved, a Lot of these Plans added to the Job later is charged with these, from the first Package that bills it.'}
        </Typography>
      </Box>
      <TableContainer sx={{ borderTop: 1, borderColor: 'divider' }}>
        <Table size="small" aria-label="Scope and Amount of each Plan" sx={[{ minWidth: 520 }, catalogTableSx]}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 180 }}>Plan</TableCell>
              <TableCell>Scope of Work</TableCell>
              <TableCell align="right" sx={{ width: 140 }}>Amount per Lot</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {order.planRules.map((rule) => (
              <TableRow key={rule.planId}>
                <TableCell>
                  <Typography variant="body2" fontWeight={700}>Plan {rule.plan}</Typography>
                  {rule.planName && (
                    <Typography variant="caption" color="text.secondary" component="div">{rule.planName}</Typography>
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{rule.scope}</TableCell>
                <TableCell align="right" sx={money}>{formatCurrency(rule.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}

/** The Extras / COs made from Packages for the Lots of these Plans billed after it was approved. */
function PackageOrdersCard({ orders }) {
  return (
    <Paper variant="outlined" component="section" aria-label="Charged from Packages" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
        <Typography variant="subtitle1" component="h2" fontWeight={700}>
          Charged from Packages
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {orders.length === 0
            ? 'No Package has billed a Lot of these Plans added later yet.'
            : 'Each Package that billed Lots of these Plans added later made an Extra / CO of its own.'}
        </Typography>
      </Box>
      {orders.length > 0 && (
        <TableContainer sx={{ borderTop: 1, borderColor: 'divider' }}>
          <Table size="small" aria-label="Extras / COs made from Packages" sx={[{ minWidth: 520 }, catalogTableSx]}>
            <TableHead>
              <TableRow>
                <TableCell>Extra / CO</TableCell>
                <TableCell>Package</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Lots</TableCell>
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link component={RouterLink} to={`/change-orders/${item.id}`} fontWeight={700}>
                      {item.number}
                    </Link>
                  </TableCell>
                  <TableCell>{item.sourcePackageNumber}</TableCell>
                  <TableCell><ChangeOrderStatusChip status={item.status} /></TableCell>
                  <TableCell align="right" sx={money}>{item.lineCount}</TableCell>
                  <TableCell align="right" sx={money}>{formatCurrency(item.totalAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  )
}

function TotalCard({ totals }) {
  return (
    <Paper variant="outlined" component="section" aria-label="Total" sx={{ p: 2.5, borderRadius: 2 }}>
      <Typography variant="body2" color="text.secondary">Total</Typography>
      <Typography
        component="p"
        sx={{ ...money, fontSize: 32, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.02em', mt: 0.25 }}
      >
        {formatCurrency(totals.total)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
        {countsText(totals)}
      </Typography>
    </Paper>
  )
}

/** Where the Extra / CO has been, newest first: what it is now comes first. */
function HistoryCard({ history, cancelReason }) {
  const steps = [...history].reverse()
  const label = (status) => allChangeOrderStatuses.find((item) => item.value === status)?.label ?? status

  return (
    <Paper variant="outlined" component="section" aria-label="Status history" sx={{ p: 2.5, borderRadius: 2 }}>
      <Typography variant="subtitle1" component="h2" fontWeight={700} sx={{ mb: 2 }}>
        History
      </Typography>
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {steps.map((step, index) => {
          const current = index === 0
          const last = index === steps.length - 1
          const color = STATUS_COLORS[step.to] ?? 'text.disabled'

          return (
            <Box
              component="li"
              key={step.id}
              aria-current={current ? 'step' : undefined}
              sx={{ position: 'relative', pl: 3.5, pb: last ? 0 : 2.5 }}
            >
              {!last && (
                <Box
                  aria-hidden
                  sx={{ position: 'absolute', left: 5.5, top: 16, bottom: 0, width: '1px', bgcolor: 'divider' }}
                />
              )}
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  left: 0,
                  top: 5,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: 2,
                  borderColor: color,
                  bgcolor: current ? color : 'background.paper',
                }}
              />
              <Typography variant="body2" fontWeight={current ? 700 : 500}>
                {step.from === null ? `Created as ${label(step.to)}` : label(step.to)}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div">
                {formatDateTime(step.changedAt)}
              </Typography>
              {step.note && step.note !== cancelReason && (
                <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                  {step.note}
                </Typography>
              )}
            </Box>
          )
        })}
      </Box>
    </Paper>
  )
}

/** One Extra / Change Order: who asked, the work it charges, what it adds up to and how it got here. */
export default function ChangeOrderDetail() {
  const { changeOrderId } = useParams()
  const { order, loading, error, reload, refresh } = useChangeOrder(changeOrderId)
  // What went wrong with a move made from a button (someone else may have moved it first).
  const [actionError, setActionError] = useState('')
  // What the page that sent here wants said (the email to Scheduling went out), once.
  const location = useLocation()
  const [notice, setNotice] = useState(location.state?.notice ?? '')
  // The PO / CO # is written from here, also once the Extra / CO is approved and the form no longer opens.
  const { profile } = useAuth()
  const [editingPoCo, setEditingPoCo] = useState(false)
  const totals = useMemo(() => summarizeDetailLines(order?.lines ?? []), [order])
  const canSetPoCo = order ? canSetPoCoNumber(order.status, profile?.role) : false
  // Draw & Invoice comes from its Change Orders tab and goes back there; the list of Extras / COs is not theirs.
  const list = canOpenPage(profile?.role, 'planning') ? LIST : { label: 'Draw & Invoice', to: '/draw-invoice' }

  if (loading) {
    return (
      <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }} aria-busy="true">
        <CatalogPageHeader breadcrumbs={[list, { label: 'Loading…' }]} title="Extra / Change Order" />
        <Box sx={{ p: { xs: 2.5, md: 4 } }}>
          <Skeleton variant="rounded" height={160} sx={{ mb: 3 }} />
          <Skeleton variant="rounded" height={260} />
        </Box>
      </Box>
    )
  }

  if (error || !order) {
    return (
      <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
        <CatalogPageHeader breadcrumbs={[list, { label: 'Not available' }]} title="Extra / Change Order" />
        <Box sx={{ p: { xs: 2.5, md: 4 } }}>
          {error ? (
            <Alert
              severity="error"
              action={<Button color="inherit" size="small" onClick={reload}>Retry</Button>}
            >
              {error}
            </Alert>
          ) : (
            <Paper variant="outlined" sx={{ borderRadius: 2 }}>
              <CatalogEmptyState
                title="This Extra / Change Order does not exist"
                description="It may have been opened from an old link."
                action={(
                  <Button component={RouterLink} to="/change-orders" variant="outlined" size="small">
                    Back to Extras / Change Orders
                  </Button>
                )}
              />
            </Paper>
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader
        breadcrumbs={[list, { label: order.number }]}
        title={order.number}
        titleAdornment={<ChangeOrderStatusChip status={order.status} />}
        meta={<Facts order={order} onEditPoCo={canSetPoCo ? () => setEditingPoCo(true) : undefined} />}
        actions={(
          // The QuickBooks button first, as on a Package; then what can be done with the Extra / CO.
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <ChangeOrderInvoiceButton order={order} onChanged={refresh} startOpen={Boolean(location.state?.openInvoice)} />
            <ChangeOrderActions order={order} onChanged={refresh} onError={setActionError} />
          </Stack>
        )}
      />

      {editingPoCo && canSetPoCo && (
        <PoCoNumberDialog
          order={order}
          onClose={() => setEditingPoCo(false)}
          onSaved={async (message) => {
            setEditingPoCo(false)
            setActionError('')
            setNotice(message)
            await refresh()
          }}
        />
      )}

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {(notice || actionError || order.status === 'CANCELLED') && (
          <Stack spacing={2} sx={{ mb: 3 }}>
            {notice && (
              <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>
            )}
            {actionError && (
              <Alert severity="error" onClose={() => setActionError('')}>{actionError}</Alert>
            )}
            {order.status === 'CANCELLED' && (
              <Alert severity="warning">
                Cancelled on {formatDateTime(order.cancelledAt)}: {order.cancelReason}
              </Alert>
            )}
          </Stack>
        )}

        {/* On a phone the total comes first; from lg the work is on the left, the total and history beside it. */}
        <Box
          sx={{
            display: 'grid',
            gap: 3,
            alignItems: 'start',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 300px' },
            gridTemplateRows: { lg: 'auto 1fr' },
            gridTemplateAreas: {
              xs: '"total" "work" "history"',
              lg: '"work total" "work history"',
            },
          }}
        >
          <Stack spacing={3} sx={{ gridArea: 'work', minWidth: 0 }}>
            <WorkCard order={order} totals={totals} />
            {order.planRules.length > 0 && <PlanRulesCard order={order} />}
            {(order.planRules.length > 0 && order.status !== 'DRAFT' && order.status !== 'PENDING')
              || order.packageOrders.length > 0
              ? <PackageOrdersCard orders={order.packageOrders} />
              : null}
            <EventCard order={order} />
          </Stack>
          <Box sx={{ gridArea: 'total' }}>
            <TotalCard totals={totals} />
          </Box>
          <Box sx={{ gridArea: 'history' }}>
            <HistoryCard history={order.history} cancelReason={order.cancelReason} />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
