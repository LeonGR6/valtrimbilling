import { useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import timeGridPlugin from '@fullcalendar/timegrid'
import esLocale from '@fullcalendar/core/locales/es'
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded'
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ConstructionRoundedIcon from '@mui/icons-material/ConstructionRounded'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import HomeWorkOutlinedIcon from '@mui/icons-material/HomeWorkOutlined'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined'
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import {
  calendarStatusOptions,
  calendarStatusTone,
  emptyCalendarDraft,
  initialCalendarEvents,
} from '../data/calendarEvents.js'
import { calendarEventSchema } from '../schemas/calendarEventSchema.js'
import './CalendarScheduler.css'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
})

const dateFormatter = new Intl.DateTimeFormat('es-MX', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat('es-MX', {
  hour: '2-digit', minute: '2-digit', hour12: false,
})

function getLocalDateInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getTimeInput(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function getLotsLabel(lots) {
  if (!lots) return 'Sin lote'
  return lots.includes(',') || lots.includes('–') || lots.includes('-') ? `Lotes ${lots}` : `Lote ${lots}`
}

function SummaryCard({ icon, label, value, tone }) {
  return (
    <Card variant="outlined" className={`calendar-summary calendar-summary--${tone}`}>
      <CardContent>
        <Box className="calendar-summary__icon">{icon}</Box>
        <Box>
          <Typography variant="h5" fontWeight={750} sx={{ lineHeight: 1 }}>{value}</Typography>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

function EventCard({ event, timeText }) {
  const { code, community, phase, building, status } = event.extendedProps
  return (
    <Box className={`work-event work-event--${calendarStatusTone[status] ?? 'confirmed'}`}>
      <Box className="work-event__topline">
        <strong>{code}</strong>
        <span>{event.title.replace(`${code} • `, '')}</span>
      </Box>
      <span className="work-event__location">{community} · {phase.replace('Fase ', 'P')} · {building.replace('Edificio ', 'B')}</span>
      <Box className="work-event__meta">
        <span>{timeText}</span>
        <em>{status}</em>
      </Box>
    </Box>
  )
}

function DetailRow({ icon, label, children }) {
  return (
    <Box className="event-detail__row">
      <Box className="event-detail__row-icon">{icon}</Box>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={600}>{children}</Typography>
    </Box>
  )
}

function EventDetail({ event, onClose, onEdit, onComplete }) {
  if (!event) return null

  const props = event.extendedProps
  const start = new Date(event.start)
  const end = new Date(event.end)

  return (
    <Box className="event-detail">
      <Box className="event-detail__header">
        <Box>
          <Typography variant="overline" color="primary.main" fontWeight={800}>Detalle de la actividad</Typography>
          <Typography variant="h6" fontWeight={750}>Trabajo programado</Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Cerrar detalle" size="small">
          <CloseRoundedIcon />
        </IconButton>
      </Box>

      <Box className="event-detail__title">
        <Box className={`event-detail__code event-detail__code--${calendarStatusTone[props.status]}`}>{props.code}</Box>
        <Box>
          <Typography variant="h6" fontWeight={750}>{props.workType}</Typography>
          <Typography variant="body2" color="text.secondary">{getLotsLabel(props.lots)}</Typography>
        </Box>
      </Box>

      <Chip className={`status-chip status-chip--${calendarStatusTone[props.status]}`} label={props.status} size="small" />

      <Divider sx={{ my: 2.25 }} />

      <Stack spacing={1.65}>
        <DetailRow icon={<BusinessRoundedIcon />} label="Builder">{props.builder}</DetailRow>
        <DetailRow icon={<LocationOnOutlinedIcon />} label="Comunidad">{props.community}</DetailRow>
        <DetailRow icon={<LayersOutlinedIcon />} label="Fase / Edificio">{props.phase} / {props.building}</DetailRow>
        <DetailRow icon={<HomeWorkOutlinedIcon />} label="Lotes">{props.lots}</DetailRow>
        <DetailRow icon={<CalendarMonthRoundedIcon />} label="Fecha">{dateFormatter.format(start)}</DetailRow>
        <DetailRow icon={<ScheduleRoundedIcon />} label="Horario">{timeFormatter.format(start)}–{timeFormatter.format(end)}</DetailRow>
        <DetailRow icon={<ConstructionRoundedIcon />} label="Responsable">{props.foreman}</DetailRow>
      </Stack>

      <Paper variant="outlined" className="draw-card">
        <Box className="draw-card__icon"><DescriptionOutlinedIcon /></Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" color="text.secondary">DRAW SCHEDULE</Typography>
          <Typography variant="subtitle2" fontWeight={750}>{props.plan} · {props.progress}%</Typography>
          <Typography variant="body2">{currencyFormatter.format(props.rate)} <Typography component="span" variant="caption" color="text.secondary">por lote</Typography></Typography>
        </Box>
        <ArrowForwardIosRoundedIcon fontSize="small" color="action" />
      </Paper>

      <Box className="event-detail__actions">
        <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={onEdit} fullWidth>
          Editar actividad
        </Button>
        <Button
          variant="contained"
          startIcon={<CheckCircleOutlineRoundedIcon />}
          onClick={onComplete}
          disabled={props.status === 'Completado'}
          fullWidth
          disableElevation
        >
          {props.status === 'Completado' ? 'Trabajo completado' : 'Marcar completado'}
        </Button>
      </Box>
    </Box>
  )
}

function EventDialog({ open, draft, isEditing, onChange, onClose, onSave }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" component="form" onSubmit={onSave}>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" fontWeight={750}>{isEditing ? 'Editar actividad' : 'Nueva actividad'}</Typography>
        <Typography variant="body2" color="text.secondary">Programa el trabajo y asígnalo a una ubicación y cuadrilla.</Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.25}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Código" value={draft.code} onChange={(event) => onChange('code', event.target.value.toUpperCase())} required sx={{ flex: 0.45 }} />
            <TextField label="Tipo de trabajo" value={draft.workType} onChange={(event) => onChange('workType', event.target.value)} required fullWidth />
          </Stack>
          <TextField label="Lotes / unidades" placeholder="Ej. 9, 10, 11" value={draft.lots} onChange={(event) => onChange('lots', event.target.value)} required />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Fecha" type="date" value={draft.date} onChange={(event) => onChange('date', event.target.value)} required fullWidth slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="Inicio" type="time" value={draft.startTime} onChange={(event) => onChange('startTime', event.target.value)} required fullWidth slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="Fin" type="time" value={draft.endTime} onChange={(event) => onChange('endTime', event.target.value)} required fullWidth slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Builder" value={draft.builder} onChange={(event) => onChange('builder', event.target.value)} required fullWidth />
            <TextField label="Comunidad" value={draft.community} onChange={(event) => onChange('community', event.target.value)} required fullWidth />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Fase" value={draft.phase} onChange={(event) => onChange('phase', event.target.value)} fullWidth />
            <TextField label="Edificio" value={draft.building} onChange={(event) => onChange('building', event.target.value)} fullWidth />
            <FormControl fullWidth>
              <InputLabel id="event-status-label">Estado</InputLabel>
              <Select labelId="event-status-label" label="Estado" value={draft.status} onChange={(event) => onChange('status', event.target.value)}>
                {calendarStatusOptions.map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Responsable" value={draft.foreman} onChange={(event) => onChange('foreman', event.target.value)} fullWidth />
            <TextField label="Cuadrilla" value={draft.crew} onChange={(event) => onChange('crew', event.target.value)} fullWidth />
          </Stack>
          <Alert severity="info">También puedes arrastrar una actividad en el calendario para reprogramarla.</Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="contained" disableElevation>{isEditing ? 'Guardar cambios' : 'Crear actividad'}</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function CalendarScheduler() {
  const calendarRef = useRef(null)
  const compactDetail = useMediaQuery((theme) => theme.breakpoints.down('lg'))
  const [events, setEvents] = useState(initialCalendarEvents)
  const [selectedId, setSelectedId] = useState('evt-101')
  const [viewTitle, setViewTitle] = useState('10 – 14 de agosto de 2026')
  const [viewType, setViewType] = useState('timeGridWeek')
  const [filters, setFilters] = useState({ builder: 'KB Home', community: 'Andara', phase: 'Fase 1', building: 'Edificio 3' })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(emptyCalendarDraft)
  const [notice, setNotice] = useState('')

  const filterOptions = useMemo(() => ({
    builder: [...new Set(events.map((event) => event.extendedProps.builder))],
    community: [...new Set(events.map((event) => event.extendedProps.community))],
    phase: [...new Set(events.map((event) => event.extendedProps.phase))],
    building: [...new Set(events.map((event) => event.extendedProps.building))],
  }), [events])

  const filteredEvents = useMemo(() => events.filter((event) => (
    Object.entries(filters).every(([key, value]) => value === 'Todos' || event.extendedProps[key] === value)
  )), [events, filters])

  const selectedEvent = events.find((event) => event.id === selectedId) ?? null
  const completedCount = filteredEvents.filter((event) => event.extendedProps.status === 'Completado').length
  const billingCount = filteredEvents.filter((event) => event.extendedProps.billingReady).length
  const exceptionCount = filteredEvents.filter((event) => event.extendedProps.status === 'Excepción').length

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

  const openCreateDialog = (selection) => {
    const start = selection?.start ?? new Date('2026-08-10T09:00:00')
    const end = selection?.end ?? new Date(start.getTime() + (2 * 60 * 60 * 1000))
    setEditingId(null)
    setDraft({
      ...emptyCalendarDraft,
      date: getLocalDateInput(start),
      startTime: getTimeInput(start),
      endTime: getTimeInput(end),
      builder: filters.builder === 'Todos' ? 'KB Home' : filters.builder,
      community: filters.community === 'Todos' ? 'Andara' : filters.community,
      phase: filters.phase === 'Todos' ? 'Fase 1' : filters.phase,
      building: filters.building === 'Todos' ? 'Edificio 3' : filters.building,
    })
    setDialogOpen(true)
  }

  const openEditDialog = () => {
    if (!selectedEvent) return
    const start = new Date(selectedEvent.start)
    const end = new Date(selectedEvent.end)
    setEditingId(selectedEvent.id)
    setDraft({
      ...emptyCalendarDraft,
      ...selectedEvent.extendedProps,
      date: getLocalDateInput(start),
      startTime: getTimeInput(start),
      endTime: getTimeInput(end),
    })
    setDialogOpen(true)
  }

  const saveEvent = (event) => {
    event.preventDefault()
    const result = calendarEventSchema.safeParse(draft)

    if (!result.success) {
      setNotice(result.error.issues[0]?.message ?? 'Revisa los datos de la actividad.')
      return
    }

    const values = result.data
    const start = `${values.date}T${values.startTime}:00`
    const end = `${values.date}T${values.endTime}:00`

    const eventData = {
      id: editingId ?? `evt-${Date.now()}`,
      title: `${values.code} • ${getLotsLabel(values.lots)}`,
      start,
      end,
      extendedProps: {
        code: values.code,
        workType: values.workType,
        lots: values.lots,
        builder: values.builder,
        community: values.community,
        phase: values.phase,
        building: values.building,
        status: values.status,
        foreman: values.foreman,
        crew: values.crew,
        plan: values.plan,
        progress: values.status === 'Completado' ? 100 : (values.progress ?? 0),
        rate: values.rate,
        billingReady: values.status === 'Completado' ? (values.billingReady ?? true) : false,
      },
    }

    setEvents((current) => editingId
      ? current.map((item) => item.id === editingId ? eventData : item)
      : [...current, eventData])
    setSelectedId(eventData.id)
    setDialogOpen(false)
    setNotice(editingId ? 'Actividad actualizada.' : 'Actividad creada y agregada al calendario.')
  }

  const updateEventTime = (changeInfo) => {
    const changed = changeInfo.event
    setEvents((current) => current.map((event) => event.id === changed.id ? {
      ...event,
      start: changed.start?.toISOString() ?? event.start,
      end: changed.end?.toISOString() ?? event.end,
    } : event))
    setNotice('Actividad reprogramada.')
  }

  const markCompleted = () => {
    if (!selectedId) return
    setEvents((current) => current.map((event) => event.id === selectedId ? {
      ...event,
      extendedProps: { ...event.extendedProps, status: 'Completado', progress: 100, billingReady: true },
    } : event))
    setNotice('Trabajo completado y listo para facturación.')
  }

  const detail = selectedEvent ? (
    <EventDetail
      event={selectedEvent}
      onClose={() => setSelectedId(null)}
      onEdit={openEditDialog}
      onComplete={markCompleted}
    />
  ) : null

  return (
    <Box className="calendar-page">
      <Box className="calendar-page__header">
        <Box>
          <Typography variant="h4" fontWeight={780} letterSpacing="-0.025em">Calendario de obra</Typography>
          <Typography color="text.secondary">Programa trabajos por comunidad, fase, edificio y lote.</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => openCreateDialog()} disableElevation>
          Nueva actividad
        </Button>
      </Box>

      <Box className="calendar-toolbar">
        {[
          ['builder', 'Builder', <BusinessRoundedIcon key="builder" fontSize="small" />],
          ['community', 'Comunidad', <LocationOnOutlinedIcon key="community" fontSize="small" />],
          ['phase', 'Fase', <LayersOutlinedIcon key="phase" fontSize="small" />],
          ['building', 'Edificio', <ApartmentRoundedIcon key="building" fontSize="small" />],
        ].map(([key, label, icon]) => (
          <FormControl key={key} size="small" className="calendar-filter">
            <InputLabel id={`${key}-filter-label`}>{label}</InputLabel>
            <Select
              labelId={`${key}-filter-label`}
              label={label}
              value={filters[key]}
              onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}
              startAdornment={<Box className="calendar-filter__icon">{icon}</Box>}
            >
              <MenuItem value="Todos">Todos</MenuItem>
              {filterOptions[key].map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
            </Select>
          </FormControl>
        ))}

        <Box className="calendar-toolbar__spacer" />

        <ButtonGroup size="small" variant="outlined" aria-label="Cambiar vista">
          <Button className={viewType === 'timeGridWeek' ? 'is-active' : ''} onClick={() => changeView('timeGridWeek')}>Semana</Button>
          <Button className={viewType === 'timeGridDay' ? 'is-active' : ''} onClick={() => changeView('timeGridDay')}>Día</Button>
          <Button className={viewType === 'dayGridMonth' ? 'is-active' : ''} onClick={() => changeView('dayGridMonth')}>Mes</Button>
        </ButtonGroup>
      </Box>

      <Box className="calendar-summary-row">
        <SummaryCard icon={<CalendarMonthRoundedIcon />} value={filteredEvents.length} label="actividades" tone="scheduled" />
        <SummaryCard icon={<CheckCircleOutlineRoundedIcon />} value={completedCount} label="completadas" tone="completed" />
        <SummaryCard icon={<PaymentsOutlinedIcon />} value={billingCount} label="por facturar" tone="billing" />
        <SummaryCard icon={<ErrorOutlineRoundedIcon />} value={exceptionCount} label="excepciones" tone="exception" />
      </Box>

      <Box className="calendar-workspace">
        <Box className="calendar-main">
          <Box className="calendar-period">
            <Box>
              <Typography variant="overline" color="text.secondary" fontWeight={700}>PROGRAMACIÓN</Typography>
              <Typography variant="h6" fontWeight={750} sx={{ textTransform: 'capitalize' }}>{viewTitle}</Typography>
            </Box>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Button size="small" color="inherit" onClick={() => navigateCalendar('today')}>Hoy</Button>
              <Tooltip title="Periodo anterior"><IconButton size="small" onClick={() => navigateCalendar('prev')}><ArrowBackIosNewRoundedIcon fontSize="inherit" /></IconButton></Tooltip>
              <Tooltip title="Periodo siguiente"><IconButton size="small" onClick={() => navigateCalendar('next')}><ArrowForwardIosRoundedIcon fontSize="inherit" /></IconButton></Tooltip>
            </Stack>
          </Box>

          <Box className="calendar-canvas">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView="timeGridWeek"
              initialDate="2026-08-10"
              locale={esLocale}
              firstDay={1}
              weekends={false}
              headerToolbar={false}
              allDaySlot={false}
              slotMinTime="08:00:00"
              slotMaxTime="18:00:00"
              slotDuration="00:30:00"
              slotLabelInterval="01:00:00"
              slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
              eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
              dayHeaderFormat={{ weekday: 'short', day: 'numeric' }}
              height="100%"
              expandRows
              nowIndicator
              editable
              selectable
              selectMirror
              selectConstraint={{ startTime: '08:00', endTime: '18:00' }}
              events={filteredEvents}
              eventClick={({ event }) => setSelectedId(event.id)}
              eventContent={(info) => <EventCard event={info.event} timeText={info.timeText} />}
              eventClassNames={({ event }) => [
                `fc-work-event--${calendarStatusTone[event.extendedProps.status] ?? 'confirmed'}`,
                event.id === selectedId ? 'fc-work-event--selected' : '',
              ]}
              eventDrop={updateEventTime}
              eventResize={updateEventTime}
              select={(selection) => {
                openCreateDialog(selection)
                selection.view.calendar.unselect()
              }}
              dateClick={({ date }) => viewType === 'dayGridMonth' && openCreateDialog({ start: date, end: new Date(date.getTime() + (2 * 60 * 60 * 1000)) })}
              datesSet={({ view }) => {
                setViewTitle(view.title)
                setViewType(view.type)
              }}
            />
          </Box>
        </Box>

        {!compactDetail && selectedEvent && <Paper variant="outlined" className="calendar-detail-panel">{detail}</Paper>}
      </Box>

      {compactDetail && (
        <Drawer
          anchor="right"
          open={Boolean(selectedEvent)}
          onClose={() => setSelectedId(null)}
          slotProps={{ paper: { sx: { width: { xs: '100%', sm: 360 }, maxWidth: '100%' } } }}
        >
          {detail}
        </Drawer>
      )}

      <EventDialog
        open={dialogOpen}
        draft={draft}
        isEditing={Boolean(editingId)}
        onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))}
        onClose={() => setDialogOpen(false)}
        onSave={saveEvent}
      />

      <Snackbar open={Boolean(notice)} autoHideDuration={3200} onClose={() => setNotice('')} message={notice} />
    </Box>
  )
}
