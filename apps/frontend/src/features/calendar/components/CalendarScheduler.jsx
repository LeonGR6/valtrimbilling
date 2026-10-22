import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  LinearProgress,
  Snackbar,
} from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import { usePersistentState } from '../../../hooks/usePersistentState.js'
import { useAuth } from '../../auth/context/useAuth.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import { useBuilders } from '../../builders/context/useBuilders.js'
import { usePeople } from '../../people/context/usePeople.js'
import { useBuilderContacts } from '../../builder-contacts/context/useBuilderContacts.js'
import {
  createDraftFromProductionEvent,
  createEmptyProductionDraft,
} from '../data/calendarEvents.js'
import { useProductionActivities } from '../context/useProductionActivities.js'
import { getBuilderDateConfiguration } from '../../builders/data/builders.js'
import { usePhaseCalendarCoverage } from '../hooks/usePhaseCalendarCoverage.js'
import { calendarEventSchema } from '../schemas/calendarEventSchema.js'
import {
  getGoogleCalendarConnection,
  startGoogleCalendarOAuth,
  syncGoogleCalendarNow,
} from '../services/googleCalendarRepository.js'
import {
  googleOAuthReturnMessage,
  googleSyncSummary,
} from '../services/googleCalendarRecord.js'
import ActivityDetail from './ActivityDetail.jsx'
import ActivityForm from './ActivityForm.jsx'
import BuilderDateSettings from './BuilderDateSettings.jsx'
import BuilderFollowUpQueue from './BuilderFollowUpQueue.jsx'
import DmReminders from './DmReminders.jsx'
import CalendarPageHeader from './CalendarPageHeader.jsx'
import CalendarWorkspace from './CalendarWorkspace.jsx'
import UnscheduledPhases from './UnscheduledPhases.jsx'
import ChangeOrdersPlaceholder from './ChangeOrdersPlaceholder.jsx'
import {
  calculateProductionDates,
} from '../utils/calendarDateRules.js'
import {
  filterCalendarEvents,
  resolveCalendarScope,
} from '../utils/calendarEventFilters.js'
import { parseCalendarSchedule } from '../utils/calendarRoutes.js'
import { describeDateChanges, moveEventInDraft } from '../utils/calendarEventMove.js'
import { searchCalendarEvents } from '../utils/calendarEventSearch.js'
import {
  extraEventLabel,
  isExtraEventVariant,
  removeExtraEventFromDraft,
} from '../utils/calendarExtraEvents.js'
import { existingPhaseEvents } from '../utils/phaseCalendarCoverage.js'
import {
  findJobBuilder,
  getPhasePatch,
  formatPhaseBuilding,
} from './calendarSchedulerUtils.js'
import './CalendarScheduler.css'

// Production is the only mode shown; a CHANGE_ORDERS value saved earlier is ignored.
const CALENDAR_MODES = ['PRODUCTION']
const CALENDAR_TABS = ['SCHEDULE', 'BUILDER_SETTINGS', 'FOLLOW_UPS', 'DM_REMINDERS', 'UNSCHEDULED']
const CALENDAR_VIEWS = ['dayGridMonth', 'dayGridWeek', 'listWeek', 'multiMonthYear']
const ACTIVITY_TYPES = ['EXT', 'SHUTTER', 'DM', 'HW']

const initialCalendarTitle = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}).format(new Date())

// First visit on a phone: the month grid is too narrow to read an event, so
// open on the weekly list. Anyone who picked a view keeps it.
function defaultCalendarView() {
  const isPhone = typeof window !== 'undefined'
    && window.matchMedia?.('(max-width: 700px)').matches

  return isPhone ? 'listWeek' : 'dayGridMonth'
}

export default function CalendarScheduler() {
  const calendarRef = useRef(null)
  const { profile } = useAuth()
  const { jobs, refreshJobs } = useJobs()
  const { builders } = useBuilders()
  const { people } = usePeople()
  const { contacts: builderContacts } = useBuilderContacts()
  const {
    events,
    loading: productionLoading,
    error: productionError,
    canManageProductionActivities,
    refreshProductionActivities,
    saveProductionActivity,
    cancelProductionActivity,
  } = useProductionActivities()
  const phaseCoverage = usePhaseCalendarCoverage()
  const [searchParams, setSearchParams] = useSearchParams()
  const { mode, systemMode } = useColorScheme()
  const resolvedColorMode = mode === 'system' ? systemMode : mode
  const calendarColorMode = resolvedColorMode === 'dark' ? 'dark' : 'light'
  const [calendarMode, setCalendarMode] = usePersistentState(
    'calendar:mode',
    'PRODUCTION',
    (value) => CALENDAR_MODES.includes(value),
  )
  const [activeTab, setActiveTab] = usePersistentState(
    'calendar:tab',
    'SCHEDULE',
    (value) => CALENDAR_TABS.includes(value),
  )
  const [selectedId, setSelectedId] = useState(null)
  const [drawerMode, setDrawerMode] = useState(null)
  const [draft, setDraft] = useState(createEmptyProductionDraft())
  const [formError, setFormError] = useState('')
  const [duplicateWarning, setDuplicateWarning] = useState(null)
  // Set while the configuration is open because an event was dragged.
  const [dateMove, setDateMove] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState('')
  const [googleCalendarConnection, setGoogleCalendarConnection] = useState(null)
  const [googleCalendarLoading, setGoogleCalendarLoading] = useState(true)
  const [googleCalendarSyncing, setGoogleCalendarSyncing] = useState(false)
  const [googleCalendarError, setGoogleCalendarError] = useState('')
  const [viewTitle, setViewTitle] = useState(initialCalendarTitle)
  const [viewType, setViewType] = usePersistentState(
    'calendar:view',
    defaultCalendarView(),
    (value) => CALENDAR_VIEWS.includes(value),
  )
  // The filters and the search are not remembered between visits: a filter
  // left on from before could hide events without anyone noticing.
  const [visibleTypes, setVisibleTypes] = useState(ACTIVITY_TYPES)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!profile?.id) return undefined

    let mounted = true
    getGoogleCalendarConnection()
      .then((connection) => {
        if (!mounted) return
        setGoogleCalendarConnection(connection)
        setGoogleCalendarError('')
      })
      .catch((connectionError) => {
        if (!mounted) return
        setGoogleCalendarError(connectionError.message)
      })
      .finally(() => {
        if (mounted) setGoogleCalendarLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [profile?.id])

  useEffect(() => {
    const currentUrl = new URL(window.location.href)
    const googleResult = currentUrl.searchParams.get('google')
    if (!googleResult) return

    if (googleResult === 'connected') {
      // OAuth is an external navigation result synchronized into local UI state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotice('Google Calendar connected.')
    } else {
      setGoogleCalendarError(googleOAuthReturnMessage(
        currentUrl.searchParams.get('reason'),
      ))
    }

    currentUrl.searchParams.delete('google')
    currentUrl.searchParams.delete('reason')
    window.history.replaceState({}, '', currentUrl)
  }, [])

  const [storedBuilder, setStoredBuilder] = useState('ALL')
  const [storedCommunity, setStoredCommunity] = useState('ALL')
  const [storedJobId, setStoredJobId] = useState('ALL')
  const scope = useMemo(
    () => resolveCalendarScope(events, {
      builder: storedBuilder,
      community: storedCommunity,
      jobId: storedJobId,
    }),
    [events, storedBuilder, storedCommunity, storedJobId],
  )
  const filteredEvents = useMemo(() => filterCalendarEvents(events, {
    types: visibleTypes,
    builder: scope.builder,
    community: scope.community,
    jobId: scope.jobId,
  }), [events, scope.builder, scope.community, scope.jobId, visibleTypes])
  // The search looks at every event, not only the ones the filters leave.
  const searchResults = useMemo(
    () => searchCalendarEvents(events, search),
    [events, search],
  )
  const changeScope = (field, value) => {
    // Narrowing the Builder or Community clears the choices that depended on it.
    if (field === 'builder') {
      setStoredBuilder(value)
      setStoredCommunity('ALL')
      setStoredJobId('ALL')
    } else if (field === 'community') {
      setStoredCommunity(value)
      setStoredJobId('ALL')
    } else {
      setStoredJobId(value)
    }
  }
  const clearScope = () => {
    setStoredBuilder('ALL')
    setStoredCommunity('ALL')
    setStoredJobId('ALL')
  }

  const selectedEvent = events.find((event) => event.id === selectedId) ?? null

  const closeDrawer = () => {
    setDrawerMode(null)
    setSelectedId(null)
    setDateMove(null)
    setFormError('')
  }

  const openCreateDrawer = () => {
    if (!canManageProductionActivities) return
    setDateMove(null)
    setSelectedId(null)
    setDraft(createEmptyProductionDraft())
    setFormError('')
    setDrawerMode('create')
  }

  const openScheduleDrawer = (job, phase) => {
    if (!canManageProductionActivities) return

    const emptyDraft = createEmptyProductionDraft()
    const dateConfiguration = getBuilderDateConfiguration(findJobBuilder(job, builders))
    setDateMove(null)
    setSelectedId(null)
    // Same result as choosing the Job and then the Phase in the form.
    setDraft({
      ...emptyDraft,
      jobId: job.id,
      ...calculateProductionDates(emptyDraft.extDate, dateConfiguration),
      dmShutters: false,
      shutterDate: '',
      ...getPhasePatch(job, phase, people, builderContacts),
    })
    setFormError('')
    setDrawerMode('create')
  }

  // Links from other screens: `?tab=UNSCHEDULED` opens that tab and
  // `?schedule=<jobId>:<phaseId>` opens "New activity" for that Phase.
  const requestedTab = searchParams.get('tab')
  const requestedSchedule = searchParams.get('schedule')
  // Following a link is an external navigation result synchronized into UI state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!requestedTab && !requestedSchedule) return

    const clearParams = () => {
      const next = new URLSearchParams(searchParams)
      next.delete('tab')
      next.delete('schedule')
      setSearchParams(next, { replace: true })
    }

    if (requestedSchedule) {
      const target = parseCalendarSchedule(requestedSchedule)
      if (target && jobs.length === 0) return // Jobs are still loading.

      const job = jobs.find((candidate) => candidate.id === target?.jobId)
      const phase = job?.sequenceSheet?.phases?.find(
        (candidate) => candidate.id === target.phaseId,
      )
      if (job && phase) {
        setActiveTab('SCHEDULE')
        setCalendarMode('PRODUCTION')
        openScheduleDrawer(job, phase)
      }
    } else if (CALENDAR_TABS.includes(requestedTab)) {
      setActiveTab(requestedTab)
    }
    clearParams()
    // The link is consumed once per change of the requested values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab, requestedSchedule, jobs.length])
  /* eslint-enable react-hooks/set-state-in-effect */

  const openEventOptions = (eventId) => {
    const calendarEvent = events.find((event) => event.id === eventId)
    if (!calendarEvent) return

    setDateMove(null)
    setSelectedId(eventId)
    setDraft(createDraftFromProductionEvent(calendarEvent))
    setFormError('')
    setDrawerMode('detail')
  }

  // An event dragged to another day: it is not moved yet. Its configuration
  // opens with the new date filled in so the change is confirmed (or dropped)
  // there, with the other dates the rules would move shown too.
  const startEventMove = (eventId, newDate) => {
    if (!canManageProductionActivities) return
    const calendarEvent = events.find((event) => event.id === eventId)
    if (!calendarEvent || !newDate || newDate === calendarEvent.start) return

    const props = calendarEvent.extendedProps
    const job = jobs.find((item) => item.id === Number(props.jobId))
    const original = createDraftFromProductionEvent(calendarEvent)
    const moved = moveEventInDraft({
      draft: original,
      props,
      newDate,
      configuration: getBuilderDateConfiguration(findJobBuilder(job, builders)),
    })
    const changes = describeDateChanges(original, moved)
    if (changes.length === 0) return

    setSelectedId(eventId)
    setDraft(moved)
    setFormError('')
    setDateMove({ changes })
    setDrawerMode('edit')
  }

  const openEditDrawer = () => {
    if (!selectedEvent || !canManageProductionActivities) return

    setDateMove(null)
    setDraft(createDraftFromProductionEvent(selectedEvent))
    setFormError('')
    setDrawerMode('edit')
  }

  const saveActivity = async (event) => {
    event.preventDefault()
    const result = calendarEventSchema.safeParse(draft)

    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? 'Review the production details.')
      return
    }

    // A new activity creates EXT, DM and HW together, so a Phase that already
    // has events would get the same ones twice: ask before doing that.
    const job = jobs.find((item) => item.id === Number(result.data.jobId))
    const phase = job?.sequenceSheet?.phases?.find(
      (item) => item.id === Number(result.data.phaseId),
    )
    if (
      !result.data.activityId
      && job
      && phase
      && phaseCoverage.statusOf(job, phase) === 'scheduled'
    ) {
      setDuplicateWarning({
        label: `${formatPhaseBuilding(phase.name, phase.building)} of Job #${job.code}`,
        eventId: existingPhaseEvents(events, job.id, phase.id)[0]?.eventId ?? null,
        result,
      })
      return
    }

    await persistActivity(result)
  }

  const persistActivity = async (result) => {

    const isEditing = Boolean(result.data.activityId)
    const savedActivityType = isEditing
      ? selectedEvent?.extendedProps.activityType
      : 'EXT'
    const previousProps = selectedEvent?.extendedProps
    setSaving(true)
    try {
      const { events: savedEvents } = await saveProductionActivity(result.data)
      const nextSelectedEvent = savedEvents.find((item) => (
        item.extendedProps.activityType === savedActivityType
        && item.extendedProps.variant === previousProps?.variant
        && Number(item.extendedProps.lotStart) === Number(previousProps?.lotStart)
        && Number(item.extendedProps.lotEnd) === Number(previousProps?.lotEnd)
      )) ?? savedEvents.find((item) => (
        item.extendedProps.activityType === savedActivityType
        && !isExtraEventVariant(item.extendedProps.variant)
      )) ?? savedEvents[0]

      setSelectedId(nextSelectedEvent?.id ?? null)
      setDateMove(null)
      setDrawerMode(nextSelectedEvent ? 'detail' : null)
      setFormError('')
      setNotice(isEditing
        ? 'Production activity updated.'
        : 'Production activity created with EXT, DM and HW.')
    } catch (saveError) {
      setFormError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  // Takes one extra event (install only, baseboard install, lock up) off the
  // activity, like unchecking it in the form, and leaves everything else.
  const removeExtraEvent = async () => {
    const props = selectedEvent?.extendedProps
    if (!props?.activityId || !canManageProductionActivities) {
      throw new Error('Select a persisted Production event to remove.')
    }

    const label = extraEventLabel(props.variant)
    if (!label) throw new Error('Only an extra event can be removed on its own.')

    const result = calendarEventSchema.safeParse(removeExtraEventFromDraft(
      createDraftFromProductionEvent(selectedEvent),
      props.variant,
      props.activityType,
    ))
    if (!result.success) {
      throw new Error(result.error.issues[0]?.message ?? 'Review the production details.')
    }

    setDeleting(true)
    try {
      const { events: savedEvents } = await saveProductionActivity(result.data)
      const mainEvent = savedEvents.find((item) => (
        item.extendedProps.activityType === props.activityType
        && !isExtraEventVariant(item.extendedProps.variant)
      )) ?? savedEvents[0]

      setSelectedId(mainEvent?.id ?? null)
      setDrawerMode(mainEvent ? 'detail' : null)
      setNotice(`${label} removed.`)
    } finally {
      setDeleting(false)
    }
  }

  const deleteActivity = async () => {
    const activityId = selectedEvent?.extendedProps.activityId
    if (!activityId || !canManageProductionActivities) {
      throw new Error('Select a persisted Production activity to delete.')
    }

    setDeleting(true)
    try {
      await cancelProductionActivity(activityId)
      closeDrawer()
      setNotice('Production activity deleted from Calendar.')
    } finally {
      setDeleting(false)
    }
  }

  const navigateCalendar = (direction) => {
    const api = calendarRef.current?.getApi()
    if (!api) return
    if (direction === 'prev') api.prev()
    if (direction === 'next') api.next()
    if (direction === 'today') api.today()
  }

  const changeView = (nextView) => {
    calendarRef.current?.getApi().changeView(nextView)
    setViewType(nextView)
  }

  const toggleType = (activityType) => {
    setVisibleTypes((current) => current.includes(activityType)
      ? current.filter((type) => type !== activityType)
      : [...current, activityType])
  }

  const changeActiveTab = (_, nextTab) => {
    if (!nextTab) return
    closeDrawer()
    setActiveTab(nextTab)
  }

  const changeDraft = (draftPatch) => {
    setDraft((current) => ({ ...current, ...draftPatch }))
    setFormError('')
  }

  const connectGoogleCalendar = async () => {
    if (profile?.role !== 'ADMIN') return

    setGoogleCalendarLoading(true)
    setGoogleCalendarError('')
    try {
      const authorizationUrl = await startGoogleCalendarOAuth()
      window.location.assign(authorizationUrl)
    } catch (connectionError) {
      setGoogleCalendarError(connectionError.message)
      setGoogleCalendarLoading(false)
    }
  }

  const syncGoogleCalendar = async () => {
    if (
      profile?.role !== 'ADMIN'
      || googleCalendarConnection?.status !== 'CONNECTED'
    ) return

    setGoogleCalendarSyncing(true)
    setGoogleCalendarError('')
    try {
      const result = await syncGoogleCalendarNow()
      const connection = await getGoogleCalendarConnection()
      setGoogleCalendarConnection(connection)
      if (result.failed > 0) {
        setGoogleCalendarError(googleSyncSummary(result))
      } else {
        setNotice(googleSyncSummary(result))
      }
    } catch (syncError) {
      setGoogleCalendarError(syncError.message)
      getGoogleCalendarConnection()
        .then(setGoogleCalendarConnection)
        .catch(() => {})
    } finally {
      setGoogleCalendarSyncing(false)
    }
  }

  return (
    <Box className={`calendar-page calendar-theme--${calendarColorMode}`}>
      <CalendarPageHeader
        activeTab={activeTab}
        calendarMode={calendarMode}
        onChangeTab={changeActiveTab}
        onConnectGoogleCalendar={connectGoogleCalendar}
        onSyncGoogleCalendar={syncGoogleCalendar}
        onCreate={openCreateDrawer}
        unscheduledCount={phaseCoverage.ready ? phaseCoverage.unscheduled.length : 0}
        canConnectGoogleCalendar={profile?.role === 'ADMIN'}
        canCreate={canManageProductionActivities}
        googleCalendarConnected={googleCalendarConnection?.status === 'CONNECTED'}
        googleCalendarLastSyncAt={googleCalendarConnection?.lastSyncAt}
        googleCalendarLoading={googleCalendarLoading}
        googleCalendarSyncing={googleCalendarSyncing}
      />

      {activeTab === 'BUILDER_SETTINGS' ? (
        <BuilderDateSettings />
      ) : activeTab === 'FOLLOW_UPS' ? (
        <BuilderFollowUpQueue
          canManage={canManageProductionActivities}
          canConfigure={profile?.role === 'ADMIN'}
        />
      ) : activeTab === 'DM_REMINDERS' ? (
        <DmReminders />
      ) : activeTab === 'UNSCHEDULED' ? (
        <UnscheduledPhases
          unscheduled={phaseCoverage.unscheduled}
          ready={phaseCoverage.ready}
          error={phaseCoverage.error}
          canSchedule={canManageProductionActivities}
          onSchedule={openScheduleDrawer}
          onRetry={() => {
            Promise.allSettled([refreshJobs(), refreshProductionActivities()])
          }}
        />
      ) : calendarMode === 'PRODUCTION' ? (
        <>
          {productionLoading && <LinearProgress />}
          {productionError && (
            <Alert
              severity="error"
              action={(
                <Button color="inherit" size="small" onClick={() => refreshProductionActivities().catch(() => {})}>
                  Retry
                </Button>
              )}
            >
              {productionError}
            </Alert>
          )}
          {googleCalendarError && (
            <Alert severity="error" onClose={() => setGoogleCalendarError('')}>
              {googleCalendarError}
            </Alert>
          )}
          <CalendarWorkspace
            calendarRef={calendarRef}
            events={filteredEvents}
            totalEventCount={events.length}
            scope={scope}
            onChangeScope={changeScope}
            onClearScope={clearScope}
            selectedId={selectedId}
            viewTitle={viewTitle}
            viewType={viewType}
            visibleTypes={visibleTypes}
            onChangeView={changeView}
            onDatesSet={(title, type) => {
              setViewTitle(title)
              setViewType(type)
            }}
            onEventClick={openEventOptions}
            onEventMove={startEventMove}
            canMove={canManageProductionActivities}
            onNavigate={navigateCalendar}
            onToggleType={toggleType}
            search={search}
            searchResults={searchResults}
            onChangeSearch={setSearch}
          />
        </>
      ) : (
        <Box className="calendar-workspace calendar-workspace--placeholder">
          <ChangeOrdersPlaceholder />
        </Box>
      )}

      <Drawer
        anchor="right"
        open={Boolean(drawerMode)}
        onClose={closeDrawer}
        slotProps={{
          paper: {
            className: 'activity-drawer',
            style: {
              '--drawer-surface': resolvedColorMode === 'dark' ? '#1e293b' : '#ffffff',
            },
            sx: { width: { xs: '100%', sm: 560 }, maxWidth: '100%' },
          },
        }}
      >
        {drawerMode === 'detail' ? (
          <ActivityDetail
            event={selectedEvent}
            jobs={jobs}
            people={people}
            builderContacts={builderContacts}
            onClose={closeDrawer}
            onEdit={openEditDrawer}
            onDelete={deleteActivity}
            onRemoveExtra={removeExtraEvent}
            canEdit={canManageProductionActivities}
            deleting={deleting}
          />
        ) : (
          <ActivityForm
            jobs={jobs}
            builders={builders}
            people={people}
            builderContacts={builderContacts}
            events={events}
            dateMove={dateMove}
            phaseStatusOf={phaseCoverage.ready ? phaseCoverage.statusOf : undefined}
            onOpenExisting={openEventOptions}
            draft={draft}
            isEditing={drawerMode === 'edit'}
            activeActivityType={selectedEvent?.extendedProps.activityType}
            formError={formError}
            onChange={changeDraft}
            onClose={closeDrawer}
            onSave={saveActivity}
            saving={saving}
          />
        )}
      </Drawer>

      <Dialog open={Boolean(duplicateWarning)} onClose={() => setDuplicateWarning(null)} maxWidth="xs" fullWidth>
        <DialogTitle>This phase already has events</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {duplicateWarning?.label} is already on the calendar. Creating this
            activity adds another EXT, DM and HW for the same phase.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {duplicateWarning?.eventId && (
            <Button
              onClick={() => {
                const { eventId } = duplicateWarning
                setDuplicateWarning(null)
                openEventOptions(eventId)
              }}
            >
              Open existing
            </Button>
          )}
          <Button color="inherit" onClick={() => setDuplicateWarning(null)}>Go back</Button>
          <Button
            variant="contained"
            color="warning"
            disableElevation
            onClick={() => {
              const { result } = duplicateWarning
              setDuplicateWarning(null)
              persistActivity(result)
            }}
          >
            Schedule anyway
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(notice)} autoHideDuration={3200} onClose={() => setNotice('')} message={notice} />
    </Box>
  )
}
