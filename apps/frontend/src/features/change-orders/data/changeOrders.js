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
  { value: 'lots', label: 'Specific Lots', description: 'Tick the lots one by one.' },
  { value: 'phase', label: 'Entire Phase / Building', description: 'Every lot of the phases or buildings you tick.' },
  { value: 'job', label: 'Entire Job', description: 'Every lot the Job has today.' },
  { value: 'plans', label: 'Specific Plan Types', description: 'Every lot with the plans you tick, now and later.' },
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
  // With Specific Plan Types, each Plan has its own Scope and Amount instead of the defaults above:
  // { [planId]: { scope, amount } }. They are what the Lots of that Plan follow, and, once the Extra / CO
  // is approved, what a Lot of that Plan billed later by a Package is charged with.
  planRules: {},
  // Lines that are not on a Lot (Sales Office, restroom): [{ id, location, scope, amount }].
  // They always have a Scope and Amount of their own.
  placeLines: [],
  // The Calendar event the lots are charged with ('EXT', 'DM', 'HW') or OWN_EVENT: `chargeEvent` for every
  // Lot, `eventByLot` for a Lot that has its own ({ [lotId]: 'DM' }); with Specific Plan Types a Plan can
  // have its own too (`planRules[planId].event`). `savedLinks` are the ties the Extra / CO already had when
  // it was opened: { [lotId]: { event, date } }.
  chargeEvent: OWN_EVENT,
  eventByLot: {},
  savedLinks: {},
  coverageMode: 'lots',
  // Each kind of coverage keeps its own selection while the person switches.
  lotIds: new Set(),
  recordIds: new Set(),
  planIds: new Set(),
}
