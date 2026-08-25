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

export const emptyContact = {
  name: '',
  type: 'JOBSITE_SUPERINTENDENT',
  builder: '',
  email: '',
  phone: '',
  officePhone: '',
  notes: '',
}

export const initialContacts = [
  {
    id: 1,
    name: 'Daniel Torres',
    type: 'JOBSITE_SUPERINTENDENT',
    builder: 'KB_HOME',
    email: 'daniel.torres@kbhome.com',
    phone: '(951) 555-0184',
    officePhone: '(951) 555-0100',
    notes: '',
  },
  {
    id: 2,
    name: 'Andrea Collins',
    type: 'JOBSITE_SUPERINTENDENT',
    builder: 'CITY_VENTURES',
    email: 'a.collins@cityventures.com',
    phone: '(415) 555-0132',
    officePhone: '',
    notes: 'Covers Cedar Grove and the north communities.',
  },
  {
    id: 3,
    name: 'Marcus Webb',
    type: 'AP_CONTACT',
    builder: 'KB_HOME',
    email: 'ap.riverside@kbhome.com',
    phone: '',
    officePhone: '(951) 555-0177',
    notes: 'Billing goes through Textura, not email.',
  },
  {
    id: 4,
    name: 'Yuki Tanaka',
    type: 'AP_CONTACT',
    builder: 'TRUMARK',
    email: 'accounts.payable@trumarkhomes.com',
    phone: '',
    officePhone: '(925) 555-0190',
    notes: '',
  },
  {
    id: 5,
    name: 'Olusegun Adeyemi',
    type: 'JOBSITE_SUPERINTENDENT',
    builder: 'BROOKFIELD',
    email: 'o.adeyemi@brookfieldrp.com',
    phone: '(714) 555-0146',
    officePhone: '',
    notes: '',
  },
  {
    id: 6,
    name: 'Rebecca Lindqvist',
    type: 'AP_CONTACT',
    builder: 'CITY_VENTURES',
    email: 'r.lindqvist@cityventures.com',
    phone: '(415) 555-0158',
    officePhone: '(415) 555-0100',
    notes: 'Prefers the payment schedule as Excel.',
  },
]
