import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Stack } from '@mui/material'

import { CatalogPageHeader } from '../../../components/common/CatalogPage'
import { useAuth } from '../../auth/context/useAuth.js'
import { emptyChangeOrder } from '../data/changeOrders.js'
import { useChangeOrderCoverage } from '../hooks/useChangeOrderCoverage.js'
import {
  canApproveChangeOrders,
  canEditChangeOrders,
  changeOrderProblems,
  problemsByField,
  toCreateChangeOrderRpc,
  toUpdateChangeOrderRpc,
  withSuggestedNumber,
} from '../services/changeOrderRecord.js'
import { createChangeOrder, updateChangeOrder } from '../services/changeOrderRepository.js'
import { shouldOfferSchedulingEmail } from '../services/changeOrderEmailRecord.js'
import { useLotCalendarEvents, useNextChangeOrderNumber } from '../hooks/useChangeOrderData.js'
import {
  evaluateLots,
  groupEvaluations,
  isCalendarEvent,
  linkedEvents,
  summarizeEvaluations,
} from '../utils/calendarEvents.js'
import ChangeOrderBasicsCard from './ChangeOrderBasicsCard.jsx'
import ChangeOrderCoverageCard from './ChangeOrderCoverageCard.jsx'
import ChangeOrderEventCard from './ChangeOrderEventCard.jsx'
import ChangeOrderLinesCard from './ChangeOrderLinesCard.jsx'
import ChangeOrderFormSection from './ChangeOrderFormSection.jsx'
import ChangeOrderSaveBar from './ChangeOrderSaveBar.jsx'
import SchedulingEmailDialog from './SchedulingEmailDialog.jsx'
import ChangeOrderStatusChip from './ChangeOrderStatusChip.jsx'
import RecentChangeOrdersCard from './RecentChangeOrdersCard.jsx'

// The button saves the Extra / CO with the status chosen in the first card.
const SAVE_LABELS = {
  DRAFT: 'Save Draft',
  PENDING: 'Submit for Approval',
  APPROVED: 'Save as Approved',
}

/**
 * The form of an Extra / CO, to create one (`mode` 'create') or to change a Draft or Pending one
 * (`mode` 'edit', with the Extra / CO it opens with in `initialValues`). Editing saves the same
 * fields; its status is moved from the Extra / CO page, not here.
 */
export default function ChangeOrderForm({
  mode = 'create',
  changeOrderId = null,
  number = '',
  initialValues = emptyChangeOrder,
}) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const editing = mode === 'edit'
  const canEdit = canEditChangeOrders(profile?.role)
  const canApprove = canApproveChangeOrders(profile?.role)
  const detailPath = `/change-orders/${changeOrderId}`

  const [values, setValues] = useState(initialValues)
  // The Internal # box of a new one starts with the number it will get; once touched, it is theirs.
  const suggestedNumber = useNextChangeOrderNumber(canEdit && !editing)
  const [numberEdited, setNumberEdited] = useState(false)
  const shownValues = useMemo(
    () => (editing ? values : withSuggestedNumber(values, suggestedNumber, numberEdited)),
    [editing, values, suggestedNumber, numberEdited],
  )
  const { job, rows, lines, places, amounts } = useChangeOrderCoverage(values)

  // The Calendar event the lots are charged with. The Calendar is only read once an event is chosen, and
  // the database decides which lots can be tied; what is shown and what is sent come from the same read.
  const choosingEvent = isCalendarEvent(values.chargeEvent)
  const { events, loading: eventsLoading, error: eventsError } = useLotCalendarEvents(
    choosingEvent && job ? job.id : '',
  )
  const evaluations = useMemo(
    () => evaluateLots(rows, { chargeEvent: values.chargeEvent, events, savedLinks: values.savedLinks }),
    [rows, values.chargeEvent, events, values.savedLinks],
  )
  const eventGroups = useMemo(() => groupEvaluations(evaluations), [evaluations])
  const eventSummary = useMemo(() => summarizeEvaluations(evaluations), [evaluations])
  const links = useMemo(() => linkedEvents(evaluations, values.chargeEvent), [evaluations, values.chargeEvent])
  // Saving without knowing what the Calendar says would let go of ties, so it waits for the Calendar.
  const calendarProblem = !(choosingEvent && job && rows.length > 0) ? ''
    : eventsLoading ? 'The Calendar events are still loading. Wait a moment, or choose Own CO event.'
      : eventsError ? 'The Calendar events could not be read. Reload the page, or choose Own CO event.'
        : ''

  // Nothing is marked until the person tries to save; after that, it follows what they fix.
  const [attempted, setAttempted] = useState(false)
  // Each failed save brings the list of what to fix into view: the bar is the only thing always on screen.
  const [failedSaves, setFailedSaves] = useState(0)
  const problemsRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  // Once saved with lots charged with a Calendar event, the person is asked about telling Scheduling
  // before leaving: { id, path } of the Extra / CO and the page to go to afterwards.
  const [emailOffer, setEmailOffer] = useState(null)

  // What is still missing, always: the steps and the bar follow it; the messages wait for a save.
  const allProblems = useMemo(() => {
    const found = changeOrderProblems(values, { lines, places })
    return calendarProblem ? [...found, { field: 'chargeEvent', message: calendarProblem }] : found
  }, [values, lines, places, calendarProblem])
  const problems = useMemo(() => (attempted ? allProblems : []), [attempted, allProblems])
  const fieldErrors = useMemo(() => problemsByField(problems), [problems])

  const problemFields = new Set(allProblems.map((problem) => problem.field))
  const hasLines = lines.length + places.length > 0
  const requestDone = !['builderId', 'jobId', 'requestedBy', 'internalNumber', 'poCoNumber', 'neededByDate']
    .some((field) => problemFields.has(field))
  const whereDone = Boolean(job) && hasLines
  const eventDone = whereDone && !calendarProblem
  const chargedDone = whereDone && !problemFields.has('lines')

  useEffect(() => {
    if (failedSaves === 0) return
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    problemsRef.current?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  }, [failedSaves])

  const handleChange = (changes) => {
    setSaveError('')
    if ('internalNumber' in changes) setNumberEdited(true)
    setValues((current) => ({ ...current, ...changes }))
  }

  const handleSave = async () => {
    setAttempted(true)
    if (allProblems.length > 0) {
      setFailedSaves((count) => count + 1)
      return
    }

    setSaving(true)
    setSaveError('')
    try {
      let savedId = changeOrderId
      if (editing) {
        await updateChangeOrder(toUpdateChangeOrderRpc(changeOrderId, values, { lines, places, links }))
      } else {
        savedId = await createChangeOrder(
          toCreateChangeOrderRpc(values, { lines, places, links, status: values.status }),
        )
      }

      const path = `/change-orders/${savedId}`
      const offer = shouldOfferSchedulingEmail({
        status: values.status,
        links,
        savedLinks: editing ? values.savedLinks : {},
      })
      // The bar stays busy while the question is open: the Extra / CO is already saved.
      if (offer) setEmailOffer({ id: savedId, path })
      else navigate(path)
    } catch (error) {
      setSaveError(error.message)
      setSaving(false)
    }
  }

  const saveLabel = editing ? 'Save changes' : (SAVE_LABELS[values.status] ?? 'Save')
  const noPermission = editing
    ? 'Your role can look at Extras / Change Orders but not change them.'
    : 'Your role can look at Extras / Change Orders but not create them.'

  return (
    <Box
      sx={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
    >
      <CatalogPageHeader
        breadcrumbs={editing
          ? [
            { label: 'Extra / Change Orders', to: '/change-orders' },
            { label: number, to: detailPath },
            { label: 'Edit' },
          ]
          : [
            { label: 'Extra / Change Orders', to: '/change-orders' },
            { label: 'New' },
          ]}
        title={editing ? `Edit ${number}` : 'New Extra / Change Order'}
        titleAdornment={<ChangeOrderStatusChip status={values.status} />}
        subtitle={editing ? undefined : 'Extra work a builder asks for, priced lot by lot.'}
      />

      <Box
        sx={{
          flex: 1,
          p: { xs: 2.5, md: 4 },
          display: 'grid',
          gap: 3,
          alignItems: 'start',
          gridTemplateColumns: editing
            ? 'minmax(0, 1fr)'
            : { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 300px' },
        }}
      >
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          {!canEdit && (
            <Alert severity="info">{noPermission}</Alert>
          )}
          {saveError && <Alert severity="error">{saveError}</Alert>}
          {problems.length > 0 && (
            <Alert severity="error" aria-label="What to fix" ref={problemsRef} sx={{ scrollMarginTop: 16 }}>
              Fix this before saving:
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                {problems.map((problem) => (
                  <li key={`${problem.field}-${problem.message}`}>{problem.message}</li>
                ))}
              </Box>
            </Alert>
          )}

          <ChangeOrderFormSection
            step={1}
            title="Request"
            hint="The Builder, the Job and who asked for it."
            done={requestDone}
            attention={attempted && !requestDone}
          >
            <ChangeOrderBasicsCard
              values={shownValues}
              onChange={handleChange}
              errors={fieldErrors}
              canApprove={canApprove}
              numberPlaceholder={suggestedNumber}
              statusLocked={editing}
            />
          </ChangeOrderFormSection>

          <ChangeOrderFormSection
            step={2}
            title="Where the work is"
            hint="The lots of the Job it reaches."
            done={whereDone}
            attention={attempted && !whereDone}
          >
            <ChangeOrderCoverageCard values={values} onChange={handleChange} />
          </ChangeOrderFormSection>

          <ChangeOrderFormSection
            step={3}
            title="Calendar event"
            hint="Charge it with an event already on the Calendar, or give it one of its own."
            done={eventDone}
            attention={attempted && Boolean(calendarProblem)}
          >
            <ChangeOrderEventCard
              chargeEvent={values.chargeEvent}
              onChange={handleChange}
              hasJob={Boolean(job)}
              hasLots={rows.length > 0}
              loading={eventsLoading}
              error={eventsError}
              groups={eventGroups}
              summary={eventSummary}
            />
          </ChangeOrderFormSection>

          <ChangeOrderFormSection
            step={4}
            title="What is charged"
            hint="The Scope of Work and the Amount of each line."
            done={chargedDone}
            attention={attempted && !chargedDone}
          >
            <ChangeOrderLinesCard values={values} onChange={handleChange} />
          </ChangeOrderFormSection>
        </Stack>

        {!editing && (
          <Box sx={{ position: { lg: 'sticky' }, top: { lg: 24 } }}>
            <RecentChangeOrdersCard />
          </Box>
        )}
      </Box>

      <ChangeOrderSaveBar
        amounts={amounts}
        problemCount={allProblems.length}
        attempted={attempted}
        saving={saving}
        canEdit={canEdit}
        noPermission={noPermission}
        saveLabel={saveLabel}
        onSave={handleSave}
        onCancel={() => navigate(editing ? detailPath : '/change-orders')}
      />

      {emailOffer && (
        <SchedulingEmailDialog
          changeOrderId={emailOffer.id}
          onClose={() => navigate(emailOffer.path)}
          onSent={(notice) => navigate(emailOffer.path, { state: { notice } })}
        />
      )}
    </Box>
  )
}
