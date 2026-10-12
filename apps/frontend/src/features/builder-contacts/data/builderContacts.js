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
  {
    value: 'ESTIMATOR',
    label: 'Estimator',
    description: 'Prices the scope of work for the builder.',
  },
  {
    value: 'JOB_COORDINATOR',
    label: 'Job Coordinator',
    description: 'Coordinates the day-to-day details of each job.',
  },
  {
    value: 'PURCHASING',
    label: 'Purchasing',
    description: 'Handles purchase orders and material buying.',
  },
  {
    value: 'SCHEDULING',
    label: 'Scheduling',
    description: 'Sets and confirms the builder’s production schedule.',
  },
  {
    value: 'OPTIONS_COORDINATOR',
    label: 'Options Coordinator',
    description: 'Manages the homebuyer options selected for each lot.',
  },
  {
    value: 'PROJECT_MANAGER',
    label: 'Project Manager',
    description: 'Oversees the builder’s projects and communities.',
  },
]

export const contactTypeLabels = Object.fromEntries(
  contactTypeOptions.map(({ value, label }) => [value, label]),
)

export const contactTypeDescriptions = Object.fromEntries(
  contactTypeOptions.map(({ value, description }) => [value, description]),
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

export const initialContacts = [
  {
    id: 1,
    name: 'Daniel Torres',
    type: 'JOBSITE_SUPERINTENDENT',
    builderId: 4,
    email: 'daniel.torres@kbhome.com',
    phone: '+19515550184',
    officePhone: '+19515550100',
    notes: '',
  },
  {
    id: 2,
    name: 'Andrea Collins',
    type: 'JOBSITE_SUPERINTENDENT',
    builderId: 1,
    email: 'a.collins@cityventures.com',
    phone: '+14155550132',
    officePhone: '',
    notes: 'Covers Cedar Grove and the north communities.',
  },
  {
    id: 3,
    name: 'Marcus Webb',
    type: 'AP_CONTACT',
    builderId: 4,
    email: 'ap.riverside@kbhome.com',
    phone: '',
    officePhone: '+19515550177',
    notes: 'Billing goes through Textura, not email.',
  },
  {
    id: 4,
    name: 'Yuki Tanaka',
    type: 'AP_CONTACT',
    builderId: 2,
    email: 'accounts.payable@trumarkhomes.com',
    phone: '',
    officePhone: '+19255550190',
    notes: '',
  },
  {
    id: 5,
    name: 'Olusegun Adeyemi',
    type: 'JOBSITE_SUPERINTENDENT',
    builderId: 3,
    email: 'o.adeyemi@brookfieldrp.com',
    phone: '+17145550146',
    officePhone: '',
    notes: '',
  },
  {
    id: 6,
    name: 'Rebecca Lindqvist',
    type: 'AP_CONTACT',
    builderId: 1,
    email: 'r.lindqvist@cityventures.com',
    phone: '+14155550158',
    officePhone: '+14155550100',
    notes: 'Prefers the payment schedule as Excel.',
  },
].map((contact) => ({ ...contact, isActive: true }))
