// Builder-side contacts. Unlike features/people — which holds Valtrim's own
// supervisors and crews — everyone here works for the builder and never signs
// in to the app.

export const contactTypeOptions = [
  {
    value: 'JOBSITE_SUPERINTENDENT',
    label: 'Jobsite Superintendent',
    description: 'Runs the jobsite. Signs off on completed work.',
  },
  {
    value: 'AP_CONTACT',
    label: 'AP Contact',
    description: 'Receives the billing package and answers payment questions.',
  },
]

export const contactTypeLabels = Object.fromEntries(
  contactTypeOptions.map(({ value, label }) => [value, label]),
)

export const contactTypeDescriptions = Object.fromEntries(
  contactTypeOptions.map(({ value, description }) => [value, description]),
)

// Legacy fixture options are still consumed by the not-yet-persisted Customer
// Service screens. Builder Contacts itself now loads builders from Supabase.
export const builderOptions = [
  { value: 'KB_HOME', label: 'KB Home' },
  { value: 'TRUMARK', label: 'Trumark Homes' },
  { value: 'CITY_VENTURES', label: 'City Ventures' },
  { value: 'BROOKFIELD', label: 'Brookfield Residential' },
]

export const builderLabels = Object.fromEntries(
  builderOptions.map(({ value, label }) => [value, label]),
)

export const emptyContact = {
  name: '',
  type: 'JOBSITE_SUPERINTENDENT',
  builderId: '',
  email: '',
  phone: '',
  officePhone: '',
  notes: '',
  isActive: true,
}
