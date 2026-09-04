// Service requests the builder raises after a lot is handed over: warranty
// work, punch list items and callbacks. A row carries the property, the
// homeowner contact and the appointment next to the request itself, which is
// what the coordinator needs on screen before picking up the phone.
// Reaches the data files directly rather than the barrels: barrels re-export
// .jsx components, which the plain Node test runner cannot load. The existing
// tests import feature data the same way.
import { builderOptions } from '../../builder-contacts/data/builderContacts.js'
import { initialPeople } from '../../people/data/people.js'
import { initialUsers } from '../../users/data/users.js'
import { toIsoDate } from '../utils/dates.js'

export { builderOptions }

// Four of the visits below are anchored to the day the app is opened, so the
// dashboard always has a plausible day of work to show instead of going empty
// as these fixtures age. Every other date here is literal — only the tiles and
// the appointment column care about today.
const today = toIsoDate(new Date())

export const builderLabelsById = Object.fromEntries(
  builderOptions.map(({ value, label }) => [value, label]),
)

// The technician who works the call is Valtrim field staff and the coordinator
// who logged it is an app user. Both are references, not names typed into the
// request.
export const technicianOptions = initialPeople.map(({ id, name }) => ({
  value: id,
  label: name,
}))

export const technicianLabelsById = Object.fromEntries(
  technicianOptions.map(({ value, label }) => [value, label]),
)

export const coordinatorOptions = initialUsers.map(({ id, name }) => ({
  value: id,
  label: name,
}))

export const coordinatorLabelsById = Object.fromEntries(
  coordinatorOptions.map(({ value, label }) => [value, label]),
)

// Customer Service is Anelda's desk, so a new request starts logged under her
// name instead of asking who is typing. Looked up by name rather than by a
// bare id so the intent survives the catalog being reordered. Once Supabase
// Auth is in place this comes from the session and stops being editable.
export const defaultCoordinatorId =
  coordinatorOptions.find(({ label }) => label === 'Anelda Calvillo')?.value ??
  coordinatorOptions[0]?.value ??
  ''

export const requestTypeOptions = [
  { value: 'WARRANTY', label: 'Builder warranty' },
  { value: 'PUNCH_LIST', label: 'Punch list' },
  { value: 'SERVICE_CALL', label: 'Service call' },
  { value: 'COMPLAINT', label: 'Complaint' },
]

export const requestTypeLabels = Object.fromEntries(
  requestTypeOptions.map(({ value, label }) => [value, label]),
)

// The flag under the request number. It overlaps the workflow status on
// purpose: it is the coarse thing a coordinator scans a column for, while the
// status tracks where the visit actually stands. Some of these could be
// derived later (NEW from the request date, OVERDUE from the appointment), so
// it stays optional until those rules are settled.
export const requestTagOptions = [
  { value: 'NEW', label: 'New', color: 'primary' },
  { value: 'FOLLOW_UP', label: 'Follow up', color: 'secondary' },
  { value: 'PARTS_NEEDED', label: 'Parts needed', color: 'warning' },
  { value: 'COMPLETED', label: 'Completed', color: 'success' },
  { value: 'OVERDUE', label: 'Overdue', color: 'error' },
]

export const requestTagsByValue = Object.fromEntries(
  requestTagOptions.map((option) => [option.value, option]),
)

export const statusOptions = [
  { value: 'NEW', label: 'New', color: 'primary' },
  { value: 'CONTACT_NEEDED', label: 'Contact needed', color: 'warning' },
  { value: 'CONFIRMED', label: 'Confirmed', color: 'success' },
  { value: 'EN_ROUTE', label: 'Route', color: 'info' },
  { value: 'AWAITING_PARTS', label: 'Awaiting parts', color: 'warning' },
  { value: 'COMPLETED', label: 'Completed', color: 'success' },
  { value: 'OVERDUE', label: 'Overdue', color: 'error' },
  // The end of the line. Reachable from any state, including a duplicate or a
  // request the homeowner withdrew, and it freezes the record: no edits, no
  // deletes, only a reopen. Grey on purpose — a closed case should not be
  // asking for attention.
  { value: 'CLOSED', label: 'Closed', color: 'neutral' },
]

export const statusesByValue = Object.fromEntries(
  statusOptions.map((option) => [option.value, option]),
)

// Closing is an action taken on a request, not a value typed into the form, so
// the form never offers it.
export const formStatusOptions = statusOptions.filter(
  ({ value }) => value !== 'CLOSED',
)

// Anything neither finished nor closed still needs someone to act on it.
export const openStatuses = statusOptions
  .filter(({ value }) => value !== 'COMPLETED' && value !== 'CLOSED')
  .map(({ value }) => value)

export function isClosed(request) {
  return request.status === 'CLOSED'
}

export const priorityOptions = [
  { value: 'LOW', label: 'Low', color: 'text.secondary' },
  { value: 'MEDIUM', label: 'Medium', color: 'warning.main' },
  { value: 'HIGH', label: 'High', color: 'error.main' },
]

export const prioritiesByValue = Object.fromEntries(
  priorityOptions.map((option) => [option.value, option]),
)

export const appointmentStateOptions = [
  { value: 'NOT_SCHEDULED', label: 'Not scheduled' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'OVERDUE', label: 'Overdue' },
]

export const appointmentStateLabels = Object.fromEntries(
  appointmentStateOptions.map(({ value, label }) => [value, label]),
)

export const emptyRequest = {
  // Filled in by the dialog from the folios already issued.
  requestNumber: '',
  tag: '',
  reportedAt: '',
  createdById: defaultCoordinatorId,
  builder: '',
  community: '',
  lotNumber: '',
  street: '',
  city: '',
  state: '',
  postalCode: '',
  plan: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  type: 'WARRANTY',
  issue: '',
  priority: 'MEDIUM',
  status: 'NEW',
  statusNote: '',
  appointmentState: 'NOT_SCHEDULED',
  appointmentDate: '',
  appointmentStart: '',
  appointmentEnd: '',
  technicianId: '',
  notes: '',
  // Written by the Close action, cleared by Reopen. Never edited in the form:
  // a lock that anyone can retype is not a lock.
  closedAt: '',
  closedById: '',
  statusBeforeClose: '',
}

export const initialRequests = [
  {
    id: 1,
    requestNumber: 'CS-1045',
    tag: 'NEW',
    reportedAt: '2026-08-26',
    createdById: 4,
    builder: 'KB_HOME',
    community: 'Andara',
    lotNumber: '24',
    street: '123 Main Street',
    city: 'Murrieta',
    state: 'CA',
    postalCode: '92562',
    plan: 'Plan 2',
    contactName: 'Maria Lopez',
    contactPhone: '(951) 555-0123',
    contactEmail: 'maria.lopez@example.com',
    type: 'WARRANTY',
    issue: 'Interior door rubbing and will not close',
    priority: 'MEDIUM',
    status: 'CONFIRMED',
    statusNote: 'Normal',
    appointmentState: 'SCHEDULED',
    appointmentDate: today,
    appointmentStart: '09:00',
    appointmentEnd: '11:00',
    technicianId: 3,
    notes: 'Call the homeowner 15 minutes before arrival. Dog in backyard.',
  },
  {
    id: 2,
    requestNumber: 'CS-1046',
    tag: '',
    reportedAt: '2026-08-26',
    createdById: 3,
    builder: 'TRUMARK',
    community: 'Dwell',
    lotNumber: '18',
    street: '456 Oak Avenue',
    city: 'Murrieta',
    state: 'CA',
    postalCode: '92562',
    plan: 'Plan 1',
    contactName: 'John Smith',
    contactPhone: '(909) 555-0182',
    contactEmail: 'john.smith@example.com',
    type: 'PUNCH_LIST',
    issue: 'Door handle loose',
    priority: 'MEDIUM',
    status: 'CONTACT_NEEDED',
    statusNote: '',
    appointmentState: 'NOT_SCHEDULED',
    appointmentDate: '',
    appointmentStart: '',
    appointmentEnd: '',
    technicianId: '',
    notes: '',
  },
  {
    id: 3,
    requestNumber: 'CS-1047',
    tag: 'FOLLOW_UP',
    reportedAt: '2026-08-25',
    createdById: 4,
    builder: 'CITY_VENTURES',
    community: 'Astaire',
    lotNumber: '7',
    street: '789 Pine Street',
    city: 'Murrieta',
    state: 'CA',
    postalCode: '92563',
    plan: 'Plan 3',
    contactName: 'Sarah Johnson',
    contactPhone: '(951) 555-0111',
    contactEmail: 'sarah.johnson@example.com',
    type: 'SERVICE_CALL',
    issue: 'Missing closet pole',
    priority: 'LOW',
    status: 'EN_ROUTE',
    statusNote: '',
    appointmentState: 'SCHEDULED',
    appointmentDate: today,
    appointmentStart: '13:00',
    appointmentEnd: '15:00',
    technicianId: 2,
    notes: '',
  },
  {
    id: 4,
    requestNumber: 'CS-1048',
    tag: 'COMPLETED',
    reportedAt: '2026-08-24',
    createdById: 1,
    builder: 'KB_HOME',
    community: 'Andara',
    lotNumber: '15',
    street: '321 Maple Drive',
    city: 'Murrieta',
    state: 'CA',
    postalCode: '92562',
    plan: 'Plan 2',
    contactName: 'David Brown',
    contactPhone: '(951) 555-0177',
    contactEmail: 'david.brown@example.com',
    type: 'WARRANTY',
    issue: 'Baseboard damage',
    priority: 'LOW',
    status: 'COMPLETED',
    statusNote: 'Awaiting sign-off',
    appointmentState: 'COMPLETED',
    appointmentDate: '2026-08-24',
    appointmentStart: '08:00',
    appointmentEnd: '10:00',
    technicianId: 3,
    notes: '',
  },
  {
    id: 5,
    requestNumber: 'CS-1049',
    tag: 'PARTS_NEEDED',
    reportedAt: '2026-08-24',
    createdById: 3,
    builder: 'BROOKFIELD',
    community: 'Willow',
    lotNumber: '5',
    street: '654 Cedar Drive',
    city: 'Murrieta',
    state: 'CA',
    postalCode: '92563',
    plan: 'Plan 1',
    contactName: 'Emily Davis',
    contactPhone: '(951) 555-0144',
    contactEmail: 'emily.davis@example.com',
    type: 'WARRANTY',
    issue: 'Hinge damaged',
    priority: 'HIGH',
    status: 'AWAITING_PARTS',
    statusNote: 'Hinge on order',
    appointmentState: 'SCHEDULED',
    appointmentDate: today,
    appointmentStart: '10:30',
    appointmentEnd: '12:30',
    technicianId: 2,
    notes: '',
  },
  {
    id: 6,
    requestNumber: 'CS-1050',
    tag: 'OVERDUE',
    reportedAt: '2026-08-20',
    createdById: 3,
    builder: 'KB_HOME',
    community: 'Cielo',
    lotNumber: '33',
    street: '987 Sunflower Court',
    city: 'Murrieta',
    state: 'CA',
    postalCode: '92562',
    plan: 'Plan 3',
    contactName: 'Michael Lee',
    contactPhone: '(951) 555-0166',
    contactEmail: 'michael.lee@example.com',
    type: 'COMPLAINT',
    issue: 'Exterior door sticking',
    priority: 'HIGH',
    status: 'OVERDUE',
    statusNote: '',
    appointmentState: 'OVERDUE',
    appointmentDate: '2026-08-24',
    appointmentStart: '',
    appointmentEnd: '',
    technicianId: '',
    notes: '',
  },
  {
    id: 7,
    requestNumber: 'CS-1051',
    tag: 'NEW',
    reportedAt: '2026-08-19',
    createdById: 4,
    builder: 'TRUMARK',
    community: 'Dwell',
    lotNumber: '22',
    street: '150 Juniper Lane',
    city: 'Menifee',
    state: 'CA',
    postalCode: '92584',
    plan: 'Plan 2',
    contactName: 'Angela Reyes',
    contactPhone: '(951) 555-0198',
    contactEmail: 'angela.reyes@example.com',
    type: 'PUNCH_LIST',
    issue: 'Shelf bracket missing in the pantry',
    priority: 'LOW',
    status: 'NEW',
    statusNote: '',
    appointmentState: 'NOT_SCHEDULED',
    appointmentDate: '',
    appointmentStart: '',
    appointmentEnd: '',
    technicianId: '',
    notes: '',
  },
  {
    id: 8,
    requestNumber: 'CS-1052',
    tag: '',
    reportedAt: '2026-08-18',
    createdById: 1,
    builder: 'CITY_VENTURES',
    community: 'Astaire',
    lotNumber: '14',
    street: '212 Willow Bend',
    city: 'Murrieta',
    state: 'CA',
    postalCode: '92563',
    plan: 'Plan 1',
    contactName: 'Peter Nguyen',
    contactPhone: '(951) 555-0120',
    contactEmail: 'peter.nguyen@example.com',
    type: 'SERVICE_CALL',
    issue: 'Pocket door off track',
    priority: 'MEDIUM',
    status: 'CONFIRMED',
    statusNote: 'Normal',
    appointmentState: 'SCHEDULED',
    appointmentDate: today,
    appointmentStart: '14:30',
    appointmentEnd: '16:30',
    technicianId: 1,
    notes: '',
  },
  {
    id: 9,
    requestNumber: 'CS-1053',
    tag: 'PARTS_NEEDED',
    reportedAt: '2026-08-17',
    createdById: 3,
    builder: 'BROOKFIELD',
    community: 'Sky',
    lotNumber: '9',
    street: '43 Larkspur Way',
    city: 'Temecula',
    state: 'CA',
    postalCode: '92592',
    plan: 'Plan 4',
    contactName: 'Rachel Kim',
    contactPhone: '(951) 555-0136',
    contactEmail: 'rachel.kim@example.com',
    type: 'WARRANTY',
    issue: 'Front entry handleset finish mismatch',
    priority: 'MEDIUM',
    status: 'AWAITING_PARTS',
    statusNote: 'Handleset on order',
    appointmentState: 'NOT_SCHEDULED',
    appointmentDate: '',
    appointmentStart: '',
    appointmentEnd: '',
    technicianId: '',
    notes: '',
  },
  {
    id: 10,
    requestNumber: 'CS-1054',
    tag: 'FOLLOW_UP',
    reportedAt: '2026-08-15',
    createdById: 4,
    builder: 'KB_HOME',
    community: 'Andara',
    lotNumber: '2',
    street: '880 Harvest Circle',
    city: 'Murrieta',
    state: 'CA',
    postalCode: '92562',
    plan: 'Plan 1',
    contactName: 'Tom Alvarez',
    contactPhone: '(951) 555-0107',
    contactEmail: 'tom.alvarez@example.com',
    type: 'COMPLAINT',
    issue: 'Crew left debris in the driveway',
    priority: 'LOW',
    status: 'CONTACT_NEEDED',
    statusNote: '',
    appointmentState: 'NOT_SCHEDULED',
    appointmentDate: '',
    appointmentStart: '',
    appointmentEnd: '',
    technicianId: '',
    notes: '',
  },
  {
    id: 11,
    requestNumber: 'CS-1055',
    tag: 'COMPLETED',
    reportedAt: '2026-08-12',
    createdById: 1,
    builder: 'TRUMARK',
    community: 'Stonebrook',
    lotNumber: '30',
    street: '17 Foxglove Street',
    city: 'Menifee',
    state: 'CA',
    postalCode: '92584',
    plan: 'Plan 3',
    contactName: 'Grace Patel',
    contactPhone: '(909) 555-0173',
    contactEmail: 'grace.patel@example.com',
    type: 'WARRANTY',
    issue: 'Closet doors out of alignment',
    priority: 'LOW',
    status: 'COMPLETED',
    statusNote: 'Signed off',
    appointmentState: 'COMPLETED',
    appointmentDate: '2026-08-14',
    appointmentStart: '09:00',
    appointmentEnd: '11:00',
    technicianId: 4,
    notes: '',
  },
  {
    id: 12,
    requestNumber: 'CS-1056',
    tag: 'OVERDUE',
    reportedAt: '2026-08-10',
    createdById: 3,
    builder: 'CITY_VENTURES',
    community: 'Cedar Grove',
    lotNumber: '11',
    street: '605 Amberwood Road',
    city: 'Temecula',
    state: 'CA',
    postalCode: '92592',
    plan: 'Plan 2',
    contactName: 'Luis Ortega',
    contactPhone: '(951) 555-0159',
    contactEmail: 'luis.ortega@example.com',
    type: 'SERVICE_CALL',
    issue: 'Weather strip on the garage entry door',
    priority: 'HIGH',
    status: 'OVERDUE',
    statusNote: '',
    appointmentState: 'OVERDUE',
    appointmentDate: '2026-08-21',
    appointmentStart: '',
    appointmentEnd: '',
    technicianId: '',
    notes: '',
  },
]
