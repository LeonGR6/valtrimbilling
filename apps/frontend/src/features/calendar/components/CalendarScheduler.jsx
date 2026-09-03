import { useMemo, useRef, useState } from 'react'
import { Box, Drawer, Snackbar } from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import { useJobs } from '../../jobs/context/useJobs.js'
import { useBuilders } from '../../builders/context/useBuilders.js'
import {
  createDraftFromProductionEvent,
  createEmptyProductionDraft,
  createProductionCalendarEvents,
  initialCalendarEvents,
  recordProductionDateHistory,
} from '../data/calendarEvents.js'
import { calendarEventSchema } from '../schemas/calendarEventSchema.js'
import ActivityDetail from './ActivityDetail.jsx'
import ActivityForm from './ActivityForm.jsx'
import BuilderDateSettings from './BuilderDateSettings.jsx'
import CalendarPageHeader from './CalendarPageHeader.jsx'
import CalendarWorkspace from './CalendarWorkspace.jsx'
import ChangeOrdersPlaceholder from './ChangeOrdersPlaceholder.jsx'
import './CalendarScheduler.css'

export default function CalendarScheduler() {
  const calendarRef = useRef(null)
  const { jobs } = useJobs()
  const { builders } = useBuilders()
  const { mode, systemMode } = useColorScheme()
  const resolvedColorMode = mode === 'system' ? systemMode : mode
  const calendarColorMode = resolvedColorMode === 'dark' ? 'dark' : 'light'
  const [calendarMode, setCalendarMode] = useState('PRODUCTION')
  const [activeTab, setActiveTab] = useState('SCHEDULE')
  const [events, setEvents] = useState(initialCalendarEvents)
  const [selectedId, setSelectedId] = useState(null)
  const [drawerMode, setDrawerMode] = useState(null)
  const [editingGroupId, setEditingGroupId] = useState(null)
  const [draft, setDraft] = useState(createEmptyProductionDraft())
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [viewTitle, setViewTitle] = useState('Aug 10 – 14, 2026')
  const [viewType, setViewType] = useState('dayGridWeek')
  const [visibleTypes, setVisibleTypes] = useState(['EXT', 'SHUTTER', 'DM', 'HW'])

  const filteredEvents = useMemo(() => events.filter((event) => (
    visibleTypes.includes(event.extendedProps.activityType)
  )), [events, visibleTypes])

  const selectedEvent = events.find((event) => event.id === selectedId) ?? null

  const closeDrawer = () => {
    setDrawerMode(null)
    setSelectedId(null)
    setEditingGroupId(null)
    setFormError('')
  }

  const openCreateDrawer = () => {
    setSelectedId(null)
    setEditingGroupId(null)
    setDraft(createEmptyProductionDraft())
    setFormError('')
    setDrawerMode('create')
  }

  const openEventOptions = (eventId) => {
    const calendarEvent = events.find((event) => event.id === eventId)
    if (!calendarEvent) return

    const groupId = calendarEvent.extendedProps.groupId ?? calendarEvent.groupId ?? calendarEvent.id
    setSelectedId(eventId)
    setDraft(createDraftFromProductionEvent(calendarEvent))
    setEditingGroupId(groupId)
    setFormError('')
    setDrawerMode('detail')
  }

  const openEditDrawer = () => {
    if (!selectedEvent) return

    const groupId = selectedEvent.extendedProps.groupId ?? selectedEvent.groupId ?? selectedEvent.id
    setDraft(createDraftFromProductionEvent(selectedEvent))
    setEditingGroupId(groupId)
    setFormError('')
    setDrawerMode('edit')
  }

  const saveActivity = (event) => {
    event.preventDefault()
    const result = calendarEventSchema.safeParse(draft)

    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? 'Review the production details.')
      return
    }

    const groupId = editingGroupId ?? `production-${Date.now()}`
    const savedValues = editingGroupId
      ? recordProductionDateHistory(result.data, selectedEvent)
      : result.data
    const nextEvents = createProductionCalendarEvents(savedValues, groupId)
    const savedActivityType = editingGroupId
      ? selectedEvent?.extendedProps.activityType
      : 'EXT'
    const previousProps = selectedEvent?.extendedProps
    const nextSelectedEvent = nextEvents.find((item) => (
      item.extendedProps.activityType === savedActivityType
      && item.extendedProps.variant === previousProps?.variant
      && Number(item.extendedProps.lotStart) === Number(previousProps?.lotStart)
      && Number(item.extendedProps.lotEnd) === Number(previousProps?.lotEnd)
    )) ?? nextEvents.find((item) => (
      item.extendedProps.activityType === savedActivityType
      && item.extendedProps.variant !== 'install-only'
    )) ?? nextEvents[0]
    setEvents((current) => {
      const withoutEditedGroup = editingGroupId
        ? current.filter((item) => (item.extendedProps.groupId ?? item.groupId ?? item.id) !== editingGroupId)
        : current
      return [...withoutEditedGroup, ...nextEvents]
    })
    setSelectedId(nextSelectedEvent.id)
    setEditingGroupId(null)
    setDrawerMode('detail')
    setFormError('')
    setNotice(editingGroupId
      ? 'Production activity updated.'
      : 'Production activity created with EXT, DM and HW.')
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

  return (
    <Box className={`calendar-page calendar-theme--${calendarColorMode}`}>
      <CalendarPageHeader
        activeTab={activeTab}
        calendarMode={calendarMode}
        onChangeTab={changeActiveTab}
        onChangeMode={changeCalendarMode}
        onCreate={openCreateDrawer}
      />

      {activeTab === 'BUILDER_SETTINGS' ? (
        <BuilderDateSettings />
      ) : calendarMode === 'PRODUCTION' ? (
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
          <ActivityDetail event={selectedEvent} onClose={closeDrawer} onEdit={openEditDrawer} />
        ) : (
          <ActivityForm
            jobs={jobs}
            builders={builders}
            draft={draft}
            isEditing={drawerMode === 'edit'}
            activeActivityType={selectedEvent?.extendedProps.activityType}
            formError={formError}
            onChange={changeDraft}
            onClose={closeDrawer}
            onSave={saveActivity}
          />
        )}
      </Drawer>

      <Snackbar open={Boolean(notice)} autoHideDuration={3200} onClose={() => setNotice('')} message={notice} />
    </Box>
  )
}
