// Company Contacts: the people who work for Valtrim. A contact can have several
// types. Builder-side people — jobsite superintendents, AP contacts and the
// contacts a builder's team typed in — live in features/builder-contacts.
export const personTypeOptions = [
  {
    value: 'SUPERVISOR',
    label: 'Supervisor',
    description: 'Valtrim field supervisor assigned to jobs. Needs a territory.',
  },
  {
    value: 'ESTIMATOR',
    label: 'Estimator',
    description: 'Prices the scope of work.',
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
    description: 'Sets and confirms the production schedule.',
  },
  {
    value: 'OPTIONS_COORDINATOR',
    label: 'Options Coordinator',
    description: 'Manages the homebuyer options selected for each lot.',
  },
  {
    value: 'PROJECT_MANAGER',
    label: 'Project Manager',
    description: 'Oversees projects and communities.',
  },
]

export const personTypeLabels = Object.fromEntries(
  personTypeOptions.map(({ value, label }) => [value, label]),
)

export const initialPeople = [
  {
    id: 1,
    name: 'Lauren Mitchell',
    phone: '+17145550162',
    officePhone: '',
    email: 'lauren.mitchell@valtriminc.com',
    types: ['SUPERVISOR'],
    territory: 'Inland Empire',
    isActive: true,
  },
  {
    id: 2,
    name: 'Robert King',
    phone: '+17145550178',
    officePhone: '+17145550100',
    email: 'robert.king@valtriminc.com',
    types: ['SUPERVISOR'],
    territory: 'Orange County',
    isActive: true,
  },
  {
    id: 3,
    name: 'Esteban Marquez',
    phone: '+19515550135',
    officePhone: '',
    email: 'esteban.marquez@valtriminc.com',
    types: ['SUPERVISOR'],
    territory: 'Riverside County',
    isActive: true,
  },
  {
    id: 4,
    name: 'Nadia Haddad',
    phone: '+19095550191',
    officePhone: '+19095550100',
    email: 'nadia.haddad@valtriminc.com',
    types: ['SUPERVISOR'],
    territory: 'High Desert',
    isActive: true,
  },
]

export const emptyPerson = {
  name: '',
  phone: '',
  officePhone: '',
  email: '',
  types: [],
  territory: '',
  isActive: true,
}
