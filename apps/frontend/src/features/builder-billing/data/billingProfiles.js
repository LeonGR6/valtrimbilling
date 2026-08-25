// Builder billing profiles (§6). Each builder decides when work is cut off,
// when billing is due and which documents must ship with it.

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

// Placeholder builder list. Replace with the builders table once the backend
// exists — this becomes a foreign key.
export const builderOptions = [
  { value: 'KB_HOME', label: 'KB Home' },
  { value: 'TRUMARK', label: 'Trumark Homes' },
  { value: 'CITY_VENTURES', label: 'City Ventures' },
  { value: 'BROOKFIELD', label: 'Brookfield Residential' },
]

export const builderLabels = Object.fromEntries(
  builderOptions.map(({ value, label }) => [value, label]),
)

export const emptyProfile = {
  builder: '',
  frequency: 'MONTHLY',
  cutoffDay: 20,
  submissionDay: 25,
  cutoffDays: [10, 25],
  cutoffWeekday: 0,
  submissionOffsetDays: 2,
  workAcceptedThrough: 'CUTOFF',
  invoiceDateRule: 'SUBMISSION',
  paymentTermsDays: 30,
  retentionPercentage: 0,
  ocipWrapPercentage: 0,
  requiresPo: false,
  requiresPaymentSchedule: false,
  requiresRelease: false,
  requiresBackup: false,
  invoiceLineFormat: 'LOT_SCOPE',
  portalName: '',
  notes: '',
  isActive: true,
}

// The three examples from the requirements, so every frequency is represented.
export const initialProfiles = [
  {
    id: 1,
    builder: 'KB_HOME',
    frequency: 'MONTHLY',
    cutoffDay: 20,
    submissionDay: 25,
    cutoffDays: [10, 25],
    cutoffWeekday: 0,
    submissionOffsetDays: 2,
    workAcceptedThrough: 'CUTOFF',
    invoiceDateRule: 'SUBMISSION',
    paymentTermsDays: 30,
    retentionPercentage: 10,
    ocipWrapPercentage: 1.5,
    requiresPo: true,
    requiresPaymentSchedule: true,
    requiresRelease: true,
    requiresBackup: false,
    invoiceLineFormat: 'LOT_SCOPE',
    portalName: 'Textura',
    notes: 'Lien releases must be notarized before submission.',
    isActive: true,
  },
  {
    id: 2,
    builder: 'TRUMARK',
    frequency: 'WEEKLY',
    cutoffDay: 20,
    submissionDay: 25,
    cutoffDays: [10, 25],
    cutoffWeekday: 0,
    submissionOffsetDays: 2,
    workAcceptedThrough: 'CUTOFF',
    invoiceDateRule: 'SUBMISSION',
    paymentTermsDays: 21,
    retentionPercentage: 0,
    ocipWrapPercentage: 0,
    requiresPo: true,
    requiresPaymentSchedule: false,
    requiresRelease: true,
    requiresBackup: false,
    invoiceLineFormat: 'LOT',
    portalName: 'GCPay',
    notes: '',
    isActive: true,
  },
  {
    id: 3,
    builder: 'CITY_VENTURES',
    frequency: 'SEMIMONTHLY',
    cutoffDay: 20,
    submissionDay: 25,
    cutoffDays: [10, 25],
    cutoffWeekday: 0,
    submissionOffsetDays: 3,
    workAcceptedThrough: 'CUTOFF',
    invoiceDateRule: 'CUTOFF',
    paymentTermsDays: 45,
    retentionPercentage: 5,
    ocipWrapPercentage: 2,
    requiresPo: false,
    requiresPaymentSchedule: true,
    requiresRelease: true,
    requiresBackup: true,
    invoiceLineFormat: 'LOT_SCOPE',
    portalName: '',
    notes: 'Uses their own release form, sent by the PM each month.',
    isActive: true,
  },
]
