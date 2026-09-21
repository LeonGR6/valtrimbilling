import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Drawer, LinearProgress, Snackbar } from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
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
import CalendarPageHeader from './CalendarPageHeader.jsx'
import CalendarWorkspace from './CalendarWorkspace.jsx'
import ChangeOrdersPlaceholder from './ChangeOrdersPlaceholder.jsx'
import './CalendarScheduler.css'

const initialCalendarTitle = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}).format(new Date())

export default function CalendarScheduler() {
  const calendarRef = useRef(null)
  const { profile } = useAuth()
  const { jobs } = useJobs()
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
  const { mode, systemMode } = useColorScheme()
  const resolvedColorMode = mode === 'system' ? systemMode : mode
  const calendarColorMode = resolvedColorMode === 'dark' ? 'dark' : 'light'
  const [calendarMode, setCalendarMode] = useState('PRODUCTION')
  const [activeTab, setActiveTab] = useState('SCHEDULE')
  const [selectedId, setSelectedId] = useState(null)
  const [drawerMode, setDrawerMode] = useState(null)
  const [draft, setDraft] = useState(createEmptyProductionDraft())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState('')
  const [googleCalendarConnection, setGoogleCalendarConnection] = useState(null)
  const [googleCalendarLoading, setGoogleCalendarLoading] = useState(true)
  const [googleCalendarSyncing, setGoogleCalendarSyncing] = useState(false)
  const [googleCalendarError, setGoogleCalendarError] = useState('')
  const [viewTitle, setViewTitle] = useState(initialCalendarTitle)
  const [viewType, setViewType] = useState('dayGridWeek')
  const [visibleTypes, setVisibleTypes] = useState(['EXT', 'SHUTTER', 'DM', 'HW'])

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

  const filteredEvents = useMemo(() => events.filter((event) => (
    visibleTypes.includes(event.extendedProps.activityType)
  )), [events, visibleTypes])

  const selectedEvent = events.find((event) => event.id === selectedId) ?? null

  const closeDrawer = () => {
    setDrawerMode(null)
    setSelectedId(null)
    setFormError('')
  }

  const openCreateDrawer = () => {
    if (!canManageProductionActivities) return
    setSelectedId(null)
    setDraft(createEmptyProductionDraft())
    setFormError('')
    setDrawerMode('create')
  }

  const openEventOptions = (eventId) => {
    const calendarEvent = events.find((event) => event.id === eventId)
    if (!calendarEvent) return

    setSelectedId(eventId)
    setDraft(createDraftFromProductionEvent(calendarEvent))
    setFormError('')
    setDrawerMode('detail')
  }

  const openEditDrawer = () => {
    if (!selectedEvent || !canManageProductionActivities) return

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
        && !['install-only', 'lock-up'].includes(item.extendedProps.variant)
      )) ?? savedEvents[0]

      setSelectedId(nextSelectedEvent?.id ?? null)
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

  const changeCalendarMode = (_, nextMode) => {
    if (!nextMode) return
    closeDrawer()
    setCalendarMode(nextMode)
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
        onChangeMode={changeCalendarMode}
        onConnectGoogleCalendar={connectGoogleCalendar}
        onSyncGoogleCalendar={syncGoogleCalendar}
        onCreate={openCreateDrawer}
        canConnectGoogleCalendar={profile?.role === 'ADMIN'}
        canCreate={canManageProductionActivities}
        googleCalendarConnected={googleCalendarConnection?.status === 'CONNECTED'}
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
            onNavigate={navigateCalendar}
            onToggleType={toggleType}
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
            canEdit={canManageProductionActivities}
            deleting={deleting}
          />
        ) : (
          <ActivityForm
            jobs={jobs}
            builders={builders}
            people={people}
            builderContacts={builderContacts}
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

      <Snackbar open={Boolean(notice)} autoHideDuration={3200} onClose={() => setNotice('')} message={notice} />
    </Box>
  )
}
