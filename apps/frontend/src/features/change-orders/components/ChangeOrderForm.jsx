import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Stack } from '@mui/material'

import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { CatalogPageHeader } from '../../../components/common/CatalogPage'
import { useAuth } from '../../auth/context/useAuth.js'
import { useBuilders } from '../../builders/context/useBuilders.js'
import { emptyChangeOrder } from '../data/changeOrders.js'
import { eventBreakdown, formSteps } from '../utils/changeOrderSummary.js'
import ChangeOrderSummaryCard from './ChangeOrderSummaryCard.jsx'
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
  linkedEvents,
  lotEventChooser,
  needsCalendar,
  planEventOf,
  setLotEvents,
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
  const { job, rows, summary: coverage, lines, places, amounts } = useChangeOrderCoverage(values)
  const { builders } = useBuilders()
  const builderName = builders.find((builder) => String(builder.id) === String(values.builderId))?.name ?? ''
  const byPlan = values.coverageMode === 'plans'

  // The Calendar event each Lot is charged with: its own, its Plan's, or the one for every Lot. The
  // Calendar is only read once some Lot chooses EXT, DM or HW, and the database decides which lots can be
  // tied; what is shown and what is sent come from the same read.
  const eventOf = useMemo(
    () => lotEventChooser(values),
    [values],
  )
  const choosingEvent = needsCalendar(rows, eventOf)
  const { events, loading: eventsLoading, error: eventsError } = useLotCalendarEvents(
    choosingEvent && job ? job.id : '',
  )
  const evaluations = useMemo(
    () => evaluateLots(rows, { eventOf, events, savedLinks: values.savedLinks }),
    [rows, eventOf, events, values.savedLinks],
  )
  const eventSummary = useMemo(() => summarizeEvaluations(evaluations), [evaluations])
  const links = useMemo(() => linkedEvents(evaluations), [evaluations])
  // The Plans chosen with Specific Plan Types, with the event each follows.
  const eventPlans = useMemo(() => {
    if (!byPlan) return []
    return (job?.sequenceSheet?.plans ?? [])
      .filter((plan) => values.planIds.has(String(plan.id)))
      .map((plan) => ({
        id: String(plan.id),
        code: plan.code,
        name: plan.name ?? '',
        lots: rows.filter((row) => row.planId === String(plan.id)).length,
        event: planEventOf(values.planRules, String(plan.id), values.chargeEvent),
      }))
  }, [byPlan, job, values.planIds, values.planRules, values.chargeEvent, rows])
  // Saving without knowing what the Calendar says would let go of ties, so it waits for the Calendar.
  const calendarProblem = !(choosingEvent && job && rows.length > 0) ? ''
    : eventsLoading ? 'The Calendar events are still loading. Wait a moment, or set the Lots to Own CO event.'
      : eventsError ? 'The Calendar events could not be read. Reload the page, or set the Lots to Own CO event.'
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
  const steps = formSteps({ requestDone, whereDone, eventDone, chargedDone, attempted })
  const breakdown = useMemo(() => eventBreakdown(evaluations), [evaluations])

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

  // A Plan: its Lots follow it, so the ones that had their own event let it go.
  const choosePlanEvent = (planId, event) => {
    const eventByLot = { ...values.eventByLot }
    for (const row of rows) if (row.planId === planId) delete eventByLot[row.lotId]
    handleChange({
      eventByLot,
      planRules: {
        ...values.planRules,
        [planId]: { scope: '', amount: '', ...values.planRules?.[planId], event },
      },
    })
  }
  // Some Lots: what they would follow anyway is not kept as their own.
  const chooseLotEvents = (lotIds, event) => {
    const followed = lotEventChooser({ ...values, eventByLot: {} })
    const rowOf = new Map(rows.map((row) => [row.lotId, row]))
    handleChange({
      eventByLot: setLotEvents(values.eventByLot ?? {}, lotIds, event, (lotId) => followed(rowOf.get(lotId) ?? { lotId })),
    })
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
            id="co-step-request"
            step={1}
            title="Request"
            detail={builderName && job ? `#${job.code}` : undefined}
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
            id="co-step-where"
            step={2}
            title="Where the work is"
            detail={coverage.lots > 0 ? `${coverage.lots} ${coverage.lots === 1 ? 'lot' : 'lots'}` : undefined}
            hint="The lots of the Job it reaches."
            done={whereDone}
            attention={attempted && !whereDone}
          >
            <ChangeOrderCoverageCard values={values} onChange={handleChange} />
          </ChangeOrderFormSection>

          <ChangeOrderFormSection
            id="co-step-event"
            step={3}
            title="Calendar event"
            hint="For every Lot, by Plan or Lot by Lot: an event already on the Calendar, or one of its own."
            done={eventDone}
            attention={attempted && Boolean(calendarProblem)}
          >
            <ChangeOrderEventCard
              plans={eventPlans}
              evaluations={evaluations}
              summary={eventSummary}
              hasJob={Boolean(job)}
              loading={eventsLoading}
              error={eventsError}
              onPlan={choosePlanEvent}
              onLots={chooseLotEvents}
            />
          </ChangeOrderFormSection>

          <ChangeOrderFormSection
            id="co-step-charged"
            step={4}
            title="What is charged"
            detail={amounts.total === null ? undefined : formatCurrency(amounts.total)}
            hint="The Scope of Work and the Amount of each line."
            done={chargedDone}
            attention={attempted && !chargedDone}
          >
            <ChangeOrderLinesCard values={values} onChange={handleChange} />
          </ChangeOrderFormSection>
        </Stack>

        {!editing && (
          <Stack spacing={3} sx={{ position: { lg: 'sticky' }, top: { lg: 24 }, minWidth: 0 }}>
            <ChangeOrderSummaryCard
              builderName={builderName}
              job={job}
              coverageMode={values.coverageMode}
              coverage={coverage}
              plans={byPlan ? eventPlans : []}
              breakdown={breakdown}
              amounts={amounts}
              steps={steps}
            />
            <RecentChangeOrdersCard />
          </Stack>
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
