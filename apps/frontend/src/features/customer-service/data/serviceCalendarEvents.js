import { normalizeServiceWorkTypes, serviceWorkTypeOptions } from './workTypes.js'
import { assignedPrototypeTechnicianIds, prototypeTechnicians } from './prototypeTechnicians.js'
import { customerServiceWindows } from '../utils/customerServiceScheduling.js'

export { serviceWorkTypeOptions } from './workTypes.js'

export function getServiceWorkTypeFilterOptions(events) {
  const options = new Map(serviceWorkTypeOptions.map((option) => [option.value, option]))
  for (const event of events) {
    for (const value of normalizeServiceWorkTypes(event.extendedProps?.workTypes)) {
      if (!options.has(value)) {
        options.set(value, {
          value,
          label: value === 'Woodwork' ? 'Woodwork (legacy)' : value,
        })
      }
    }
  }
  return [...options.values()]
}

export function filterServiceCalendarEvents(events, {
  technician = 'all',
  status = 'all',
  workType = 'all',
} = {}) {
  const selectedWorkTypes = normalizeServiceWorkTypes(workType)
  return events.filter((event) => {
    const props = event.extendedProps ?? {}
    const technicianMatches = technician === 'all'
      || (props.technicianIds ?? [props.technicianId]).some((id) => String(id) === String(technician))
    const statusMatches = status === 'all' || props.status === status
    const workTypeMatches = workType === 'all'
      || normalizeServiceWorkTypes(props.workTypes).some((type) => selectedWorkTypes.includes(type))
    return technicianMatches && statusMatches && workTypeMatches
  })
}

export const serviceAppointmentStatusOptions = [
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'WORKING', label: 'In progress' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

export const serviceAppointmentStatusLabels = Object.fromEntries(
  serviceAppointmentStatusOptions.map(({ value, label }) => [value, label]),
)

export const serviceCalendarViewOptions = [
  { value: 'dayGridMonth', label: 'Month' },
  { value: 'timeGridWeek', label: 'Week' },
  { value: 'timeGridDay', label: 'Day' },
  { value: 'listWeek', label: 'List' },
  { value: 'multiMonthYear', label: 'Year' },
]

// The same windows the server validates against.
export const serviceCustomerWindowOptions = customerServiceWindows

function timeToMinutes(value) {
  const match = String(value ?? '').match(/^(\d{2}):(\d{2})$/u)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

function minutesToTime(value) {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  if (hours > 23) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function resolveServiceCustomerWindow(start, end) {
  const exactWindow = serviceCustomerWindowOptions.find((window) => (
    window.start === start && window.end === end
  ))
  if (exactWindow) return { ...exactWindow, derived: false }

  const startMinutes = timeToMinutes(start)
  if (startMinutes === null) return null
  const containingWindow = serviceCustomerWindowOptions.find((window) => {
    const windowStart = timeToMinutes(window.start)
    const windowEnd = timeToMinutes(window.end)
    return startMinutes >= windowStart && startMinutes < windowEnd
  })
  if (containingWindow) return { ...containingWindow, derived: true }

  const derivedEnd = minutesToTime(startMinutes + 120)
  if (!derivedEnd) return null
  return {
    start,
    end: derivedEnd,
    label: `${start}–${derivedEnd}`,
    exceptional: true,
    derived: true,
  }
}

export function getServiceCalendarEventDisplayMode(viewType) {
  if (viewType === 'listWeek') return 'list'
  if (viewType === 'multiMonthYear') return 'year'
  if (viewType === 'dayGridMonth') return 'compact'
  return 'timed'
}

export function getServiceCalendarViewDescription(viewType) {
  if (viewType === 'multiMonthYear') {
    return 'Annual overview · Select a visit to open its request'
  }
  if (viewType === 'dayGridMonth') {
    return 'Monthly grid · Select a day number to open its daily schedule'
  }
  if (viewType === 'listWeek') {
    return 'Weekly agenda · Visits are grouped by day'
  }
  if (viewType === 'timeGridDay') {
    return 'Daily route · Customer windows: 8–10, 10–12 and 12–2'
  }
  return 'Weekly schedule · Appointments are shown by their two-hour customer window'
}

export function formatWorkTypes(workTypes = []) {
  const normalized = normalizeServiceWorkTypes(workTypes)
  return normalized.length ? normalized.join(' & ') : 'Work type pending'
}

export function getServiceEventTone(status) {
  if (status === 'COMPLETED') return 'completed'
  if (status === 'OVERDUE') return 'overdue'
  if (status === 'CANCELLED') return 'cancelled'
  // An in-progress visit is still a confirmed appointment; it shares that tone.
  if (status === 'CONFIRMED' || status === 'WORKING') return 'confirmed'
  return 'scheduled'
}

function createPrototypeCalendarEvent(request) {
  const isCalendarVisit = ['CONFIRMED', 'WORKING', 'COMPLETED'].includes(request.workflowStage)
  const date = request.customerWindow?.date
  const customerWindow = resolveServiceCustomerWindow(
    request.customerWindow?.start,
    request.customerWindow?.end,
  )

  if (!isCalendarVisit || !date || !customerWindow) return null

  const workTypes = normalizeServiceWorkTypes(request.workType)
  const technicianIds = assignedPrototypeTechnicianIds(request)
  const technicianId = technicianIds[0] ?? null
  const assignedTechnicians = request.assignedTechnicians ?? technicianIds.map((id) => ({
    id, name: prototypeTechnicians.find((person) => person.id === id)?.name ?? request.technicianName ?? 'Unknown technician',
  }))

  return {
    id: `service-${request.id}`,
    title: `CS · ${formatWorkTypes(workTypes)}`,
    start: `${date}T${customerWindow.start}:00`,
    end: `${date}T${customerWindow.end}:00`,
    allDay: false,
    extendedProps: {
      calendarType: 'CUSTOMER_SERVICE',
      requestId: request.id,
      requestNumber: request.requestNumber,
      status: ['COMPLETED', 'WORKING'].includes(request.workflowStage) ? request.workflowStage : 'CONFIRMED',
      workTypes,
      technicianId,
      technicianIds,
      assignedTechnicians,
      technician: assignedTechnicians.map((person) => person.name).join(', '),
      homeowner: request.contactName,
      community: request.community,
      lotNumber: request.lotNumber,
      address: request.address ?? '',
      issue: request.issue,
      notes: request.customerAvailabilityNotes ?? '',
      lastVisit: null,
      customerWindow,
      internalSlot: request.internalSlot ?? null,
      // Present only for appointments saved in Supabase; enables cancelling.
      appointment: request.appointment ?? null,
    },
  }
}

export function createServiceCalendarEventsFromRequests(requests) {
  return requests
    .map((request) => {
      if (!request.currentAppointmentId) return createPrototypeCalendarEvent(request)
      if (!request.appointmentDate || !request.appointmentStart || !request.appointmentEnd) {
        return null
      }

      const customerWindow = resolveServiceCustomerWindow(
        request.customerWindow?.start ?? request.appointmentStart,
        request.customerWindow?.end ?? request.appointmentEnd,
      )
      const appointmentDate = request.customerWindow?.date ?? request.appointmentDate
      if (!customerWindow) return null

      const workTypes = normalizeServiceWorkTypes(request.workType)
      const status = request.confirmationStatus === 'CONFIRMED'
        ? 'CONFIRMED'
        : request.appointmentState

      return {
        id: `service-${request.currentAppointmentId}`,
        title: `CS · ${formatWorkTypes(workTypes)}`,
        start: `${appointmentDate}T${customerWindow.start}:00`,
        end: `${appointmentDate}T${customerWindow.end}:00`,
        allDay: false,
        extendedProps: {
          calendarType: 'CUSTOMER_SERVICE',
          requestId: request.id,
          requestNumber: request.requestNumber,
          status,
          workTypes,
          technicianId: request.technicianId,
          technician: request.technicianName,
          homeowner: request.contactName,
          community: request.community,
          lotNumber: request.lotNumber,
          address: [request.street, request.city, request.state, request.postalCode]
            .filter(Boolean).join(', '),
          issue: request.issue,
          notes: request.internalNotes,
          lastVisit: null,
          customerWindow,
          internalSlot: {
            start: request.appointmentStart,
            end: request.appointmentEnd,
          },
        },
      }
    })
    .filter(Boolean)
}

function startOfWeek(referenceDate) {
  const date = new Date(referenceDate)
  date.setHours(12, 0, 0, 0)
  const day = date.getDay()
  const distanceToMonday = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + distanceToMonday)
  return date
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function toDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function atTime(date, time) {
  return `${toDateString(date)}T${time}:00`
}

function createServiceEvent({
  id,
  requestId,
  requestNumber,
  day,
  start,
  end,
  status = 'SCHEDULED',
  workTypes,
  technicianId,
  technician,
  homeowner,
  community,
  lotNumber,
  address,
  issue,
  notes = '',
  lastVisit = null,
}) {
  const customerWindow = resolveServiceCustomerWindow(start, end)
  if (!customerWindow) return null
  const normalizedWorkTypes = normalizeServiceWorkTypes(workTypes)

  return {
    id,
    title: `CS · ${formatWorkTypes(normalizedWorkTypes)}`,
    start: atTime(day, customerWindow.start),
    end: atTime(day, customerWindow.end),
    allDay: false,
    extendedProps: {
      calendarType: 'CUSTOMER_SERVICE',
      requestId,
      requestNumber,
      status,
      workTypes: normalizedWorkTypes,
      technicianId,
      technician,
      homeowner,
      community,
      lotNumber,
      address,
      issue,
      notes,
      lastVisit: lastVisit ? {
        ...lastVisit,
        workTypes: normalizeServiceWorkTypes(lastVisit.workTypes),
      } : null,
      customerWindow,
      internalSlot: { start, end },
    },
  }
}

export function createInitialServiceCalendarEvents(referenceDate = new Date()) {
  const monday = startOfWeek(referenceDate)

  return [
    createServiceEvent({
      id: 'service-cs-1045',
      requestId: 1,
      requestNumber: 'CS-1045',
      day: addDays(monday, 0),
      start: '09:00',
      end: '10:00',
      status: 'SCHEDULED',
      workTypes: ['HW', 'WS'],
      technicianId: 3,
      technician: 'Mike Rodriguez',
      homeowner: 'Maria Lopez',
      community: 'Andara',
      lotNumber: '24',
      address: '123 Main Street, Murrieta, CA 92562',
      issue: 'Interior door rubbing and will not close',
      notes: 'Call the homeowner 15 minutes before arrival.',
      lastVisit: {
        date: toDateString(addDays(monday, -13)),
        workTypes: ['HW'],
      },
    }),
    createServiceEvent({
      id: 'service-cs-1049',
      requestId: 5,
      requestNumber: 'CS-1049',
      day: addDays(monday, 1),
      start: '10:30',
      end: '12:00',
      status: 'CONFIRMED',
      workTypes: ['HW'],
      technicianId: 2,
      technician: 'Carlos Mendez',
      homeowner: 'Emily Davis',
      community: 'Willow',
      lotNumber: '5',
      address: '654 Cedar Drive, Murrieta, CA 92563',
      issue: 'Hinge damaged',
      notes: 'Replacement hinge is already in the service vehicle.',
    }),
    createServiceEvent({
      id: 'service-cs-1047',
      requestId: 3,
      requestNumber: 'CS-1047',
      day: addDays(monday, 2),
      start: '13:00',
      end: '14:00',
      status: 'SCHEDULED',
      workTypes: ['WS'],
      technicianId: 2,
      technician: 'Carlos Mendez',
      homeowner: 'Sarah Johnson',
      community: 'Astaire',
      lotNumber: '7',
      address: '789 Pine Street, Murrieta, CA 92563',
      issue: 'Missing closet pole',
      lastVisit: {
        date: toDateString(addDays(monday, -18)),
        workTypes: ['WS'],
      },
    }),
    createServiceEvent({
      id: 'service-cs-1052',
      requestId: 8,
      requestNumber: 'CS-1052',
      day: addDays(monday, 3),
      start: '08:30',
      end: '10:00',
      status: 'OVERDUE',
      workTypes: ['HW', 'WS'],
      technicianId: 1,
      technician: 'Daniel Ruiz',
      homeowner: 'Peter Nguyen',
      community: 'Astaire',
      lotNumber: '14',
      address: '212 Willow Bend, Murrieta, CA 92563',
      issue: 'Pocket door off track',
      lastVisit: {
        date: toDateString(addDays(monday, -11)),
        workTypes: ['HW', 'WS'],
      },
    }),
    createServiceEvent({
      id: 'service-cs-1056',
      requestId: 12,
      requestNumber: 'CS-1056',
      day: addDays(monday, 4),
      start: '12:00',
      end: '14:00',
      status: 'SCHEDULED',
      workTypes: ['HW'],
      technicianId: 3,
      technician: 'Mike Rodriguez',
      homeowner: 'Luis Ortega',
      community: 'Cedar Grove',
      lotNumber: '11',
      address: '605 Amberwood Road, Temecula, CA 92592',
      issue: 'Weather strip on the garage entry door',
      lastVisit: {
        date: toDateString(addDays(monday, -7)),
        workTypes: ['HW'],
      },
    }),
    createServiceEvent({
      id: 'service-cs-1055-completed',
      requestId: 11,
      requestNumber: 'CS-1055',
      day: addDays(monday, -5),
      start: '09:00',
      end: '10:00',
      status: 'COMPLETED',
      workTypes: ['HW'],
      technicianId: 4,
      technician: 'Anthony Clark',
      homeowner: 'Grace Patel',
      community: 'Stonebrook',
      lotNumber: '30',
      address: '17 Foxglove Street, Menifee, CA 92584',
      issue: 'Closet doors out of alignment',
      notes: 'Homeowner signed off on the completed adjustment.',
    }),
  ]
}

export function createServiceCalendarEvent({
  request,
  date,
  start,
  end,
  status,
  workTypes,
  technicianId,
  technician,
  notes,
}) {
  const customerWindow = resolveServiceCustomerWindow(start, end)
  if (!customerWindow) return null
  const normalizedWorkTypes = normalizeServiceWorkTypes(workTypes)

  return {
    id: `service-${Date.now()}`,
    title: `CS · ${formatWorkTypes(normalizedWorkTypes)}`,
    start: `${date}T${customerWindow.start}:00`,
    end: `${date}T${customerWindow.end}:00`,
    allDay: false,
    extendedProps: {
      calendarType: 'CUSTOMER_SERVICE',
      requestId: request.id,
      requestNumber: request.requestNumber,
      status,
      workTypes: normalizedWorkTypes,
      technicianId,
      technician,
      homeowner: request.contactName,
      community: request.community,
      lotNumber: request.lotNumber,
      address: `${request.street}, ${request.city}, ${request.state} ${request.postalCode}`,
      issue: request.issue,
      notes,
      lastVisit: null,
      customerWindow,
      internalSlot: { start, end },
    },
  }
}
