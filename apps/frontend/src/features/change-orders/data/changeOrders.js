export const changeOrderStatuses = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
]

// Every status an Extra / CO can have. The form only offers the first three: a new one is never cancelled.
export const allChangeOrderStatuses = [
  ...changeOrderStatuses,
  { value: 'CANCELLED', label: 'Cancelled' },
]

export const coverageModes = [
  { value: 'lots', label: 'Specific Lots' },
  { value: 'phase', label: 'Entire Phase / Building' },
  { value: 'job', label: 'Entire Job' },
  { value: 'plans', label: 'Specific Plan Types' },
]

// How long the place of a line without a Lot can be (the database accepts the same).
export const maxPlaceLength = 100

// "Own CO event": the lots are not charged with an event of the Calendar (EXT, DM or HW); each will need an
// event of its own in the Extra / CO calendar.
export const OWN_EVENT = 'NONE'

export const emptyChangeOrder = {
  internalNumber: '',
  // The PO or CO number the Builder gave for the extra, written by the person.
  poCoNumber: '',
  builderId: '',
  community: '',
  requestedBy: '',
  requestDate: '',
  neededByDate: '',
  attachments: [],
  status: 'DRAFT',
  jobId: '',
  // Every Lot is a line. The defaults fill the lines with nothing of their own;
  // `lineOverrides` holds what a Lot has of its own: { [lotId]: { scope, amount } }.
  defaultScope: '',
  defaultAmount: '',
  lineOverrides: {},
  // Lines that are not on a Lot (Sales Office, restroom): [{ id, location, scope, amount }].
  // They always have a Scope and Amount of their own.
  placeLines: [],
  // The Calendar event the lots are charged with ('EXT', 'DM', 'HW') or OWN_EVENT, and the ties the
  // Extra / CO already had when it was opened: { [lotId]: { event, date } }.
  chargeEvent: OWN_EVENT,
  savedLinks: {},
  coverageMode: 'lots',
  // Each kind of coverage keeps its own selection while the person switches.
  lotIds: new Set(),
  recordIds: new Set(),
  planIds: new Set(),
}
