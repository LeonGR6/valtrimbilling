export const MIN_DRAW_COUNT = 2
export const MAX_DRAW_COUNT = 5

export const defaultDraws = [
  { name: '', percentage: 0 },
  { name: '', percentage: 0 },
]

export const frequencyOptions = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'SEMIMONTHLY', label: 'Twice a month' },
  { value: 'WEEKLY', label: 'Weekly' },
]

export const frequencyLabels = Object.fromEntries(
  frequencyOptions.map(({ value, label }) => [value, label]),
)

export const weekdayOptions = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

export const workAcceptedOptions = [
  { value: 'CUTOFF', label: 'Cutoff date' },
  { value: 'SUBMISSION', label: 'Submission date' },
]

export const invoiceDateOptions = [
  { value: 'SUBMISSION', label: 'Submission date' },
  { value: 'CUTOFF', label: 'Cutoff date' },
  { value: 'MONTH_END', label: 'End of month' },
]

export const invoiceLineFormatOptions = [
  { value: 'LOT_SCOPE', label: 'One line per lot and scope' },
  { value: 'LOT', label: 'One line per lot' },
  { value: 'SCOPE', label: 'One line per scope' },
  { value: 'SINGLE', label: 'Single summary line' },
]

export const invoiceLineFormatLabels = Object.fromEntries(
  invoiceLineFormatOptions.map(({ value, label }) => [value, label]),
)

export const defaultBillingSettings = {
  separateHardwarePrice: false,
  optionsBillingDrawIndex: null,
  frequency: 'MONTHLY',
  cutoffDay: 20,
  submissionDay: 25,
  cutoffDays: [10, 25],
  cutoffWeekday: 0,
  submissionOffsetDays: 2,
  workAcceptedThrough: 'CUTOFF',
  invoiceDateRule: 'SUBMISSION',
  paymentTermsDays: 30,
  retentionEnabled: false,
  retentionPercentage: 0,
  ocipWrapEnabled: false,
  ocipWrapPercentage: 0,
  requiresPo: false,
  requiresPaymentSchedule: false,
  requiresRelease: false,
  requiresBackup: false,
  invoiceLineFormat: 'LOT_SCOPE',
  portalName: '',
  notes: '',
}

// One complete billing and draw setup per builder. These records merge the
// schedules and profiles that previously lived in separate catalogs.
export const initialBuilderDrawSchedules = [
  {
    id: 1,
    builderId: 2,
    draws: [
      { name: 'Trim Complete', percentage: 10 },
      { name: '', percentage: 75 },
      { name: '', percentage: 15 },
    ],
    ...defaultBillingSettings,
    frequency: 'WEEKLY',
    cutoffWeekday: 0,
    submissionOffsetDays: 2,
    paymentTermsDays: 21,
    retentionEnabled: true,
    retentionPercentage: 5,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 2.5,
    requiresPo: true,
    requiresRelease: true,
    invoiceLineFormat: 'LOT',
    portalName: 'BuilderPortal',
    optionsBillingDrawIndex: 2,
  },
  {
    id: 2,
    builderId: 4,
    draws: [
      { name: '', percentage: 25 },
      { name: '', percentage: 50 },
      { name: '', percentage: 25 },
    ],
    ...defaultBillingSettings,
    frequency: 'MONTHLY',
    cutoffDay: 20,
    submissionDay: 25,
    paymentTermsDays: 30,
    retentionEnabled: true,
    retentionPercentage: 10,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 1.5,
    requiresPo: true,
    requiresPaymentSchedule: true,
    requiresRelease: true,
    portalName: 'Textura',
    notes: 'Lien releases must be notarized before submission.',
  },
  {
    id: 3,
    builderId: 1,
    draws: [
      { name: '', percentage: 85 },
      { name: '', percentage: 15 },
    ],
    ...defaultBillingSettings,
    frequency: 'SEMIMONTHLY',
    cutoffDays: [10, 25],
    submissionOffsetDays: 3,
    invoiceDateRule: 'CUTOFF',
    paymentTermsDays: 45,
    retentionEnabled: true,
    retentionPercentage: 5,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 2,
    requiresPaymentSchedule: true,
    requiresRelease: true,
    requiresBackup: true,
    notes: 'Uses their own release form, sent by the PM each month.',
  },
]
