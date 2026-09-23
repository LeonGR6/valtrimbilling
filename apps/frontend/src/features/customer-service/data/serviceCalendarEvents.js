export const serviceWorkTypeOptions = [
  { value: 'HW', label: 'HW' },
  { value: 'WS', label: 'WS' },
]

export const serviceAppointmentStatusOptions = [
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

export const serviceAppointmentStatusLabels = Object.fromEntries(
  serviceAppointmentStatusOptions.map(({ value, label }) => [value, label]),
)

export function formatWorkTypes(workTypes = []) {
  return workTypes.length ? workTypes.join(' & ') : 'Work type pending'
}

export function getServiceEventTone(status) {
  if (status === 'COMPLETED') return 'completed'
  if (status === 'OVERDUE') return 'overdue'
  if (status === 'CANCELLED') return 'cancelled'
  if (status === 'CONFIRMED') return 'confirmed'
  return 'scheduled'
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
  return {
    id,
    title: `CS · ${formatWorkTypes(workTypes)}`,
    start: atTime(day, start),
    end: atTime(day, end),
    allDay: false,
    extendedProps: {
      calendarType: 'CUSTOMER_SERVICE',
      requestId,
      requestNumber,
      status,
      workTypes,
      technicianId,
      technician,
      homeowner,
      community,
      lotNumber,
      address,
      issue,
      notes,
      lastVisit,
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
      end: '11:00',
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
      end: '12:30',
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
      end: '15:00',
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
      start: '14:00',
      end: '16:00',
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
      end: '11:00',
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
  return {
    id: `service-${Date.now()}`,
    title: `CS · ${formatWorkTypes(workTypes)}`,
    start: `${date}T${start}:00`,
    end: `${date}T${end}:00`,
    allDay: false,
    extendedProps: {
      calendarType: 'CUSTOMER_SERVICE',
      requestId: request.id,
      requestNumber: request.requestNumber,
      status,
      workTypes,
      technicianId,
      technician,
      homeowner: request.contactName,
      community: request.community,
      lotNumber: request.lotNumber,
      address: `${request.street}, ${request.city}, ${request.state} ${request.postalCode}`,
      issue: request.issue,
      notes,
      lastVisit: null,
    },
  }
}
