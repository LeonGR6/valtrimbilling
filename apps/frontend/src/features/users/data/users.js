// Application users and their access level. Unlike features/people, these are
// internal users who sign in to the app — not builder-side contacts.
//
// `scoped` marks the roles whose access is limited to specific projects. The
// rest see every community, so the project picker is hidden for them.
export const userRoleOptions = [
  {
    value: 'ADMIN',
    label: 'Admin',
    description: 'Full access to every module and setting.',
    scoped: false,
  },
  {
    value: 'ACCOUNTING',
    label: 'Accounting',
    description: 'Invoices, draws, invoice packages, QuickBooks, payments and releases.',
    scoped: false,
  },
  {
    value: 'PROJECT_MANAGEMENT',
    label: 'Project Management',
    description: 'Projects, proposals, sequence sheets, pricing and draw setup.',
    scoped: true,
  },
  {
    value: 'SCHEDULING',
    label: 'Scheduling',
    description: 'Production calendar and job scheduling.',
    scoped: true,
  },
  {
    value: 'FIELD',
    label: 'Field / Foreman',
    description: 'Assigned work only. Marks jobs complete and never sees pricing.',
    scoped: true,
  },
  {
    value: 'READ_ONLY',
    label: 'Read Only',
    description: 'Reports only, with no ability to change anything.',
    scoped: false,
  },
]

export function isScopedRole(role) {
  return Boolean(userRoleOptions.find((option) => option.value === role)?.scoped)
}

// Placeholder project list. Replace with the communities table once the
// backend exists — project access will become a real foreign key.
export const projectOptions = [
  { value: 'ANDARA_P1', label: 'Andara Phase 1' },
  { value: 'ANDARA_P2', label: 'Andara Phase 2' },
  { value: 'CEDAR_GROVE', label: 'Cedar Grove' },
  { value: 'STONEBROOK', label: 'Stonebrook' },
  { value: 'SKY', label: 'Sky' },
]

export const projectLabels = Object.fromEntries(
  projectOptions.map(({ value, label }) => [value, label]),
)

export const userRoleLabels = Object.fromEntries(
  userRoleOptions.map(({ value, label }) => [value, label]),
)

export const userRoleDescriptions = Object.fromEntries(
  userRoleOptions.map(({ value, description }) => [value, description]),
)

export const emptyUser = {
  name: '',
  email: '',
  phone: '',
  role: 'READ_ONLY',
  // When true the user reaches every community and projectAccess is ignored.
  allProjects: true,
  projectAccess: [],
  isActive: true,
}

export const initialUsers = [
  {
    id: 1,
    name: 'Leon Garcia',
    email: 'leon.garcia@valtrim.com',
    phone: '(951) 555-0110',
    allProjects: true,
    projectAccess: [],
    role: 'ADMIN',
    isActive: true,
    lastLoginAt: '2026-08-18T15:42:00',
  },
  {
    id: 2,
    name: 'Marisol Vega',
    email: 'marisol.vega@valtrim.com',
    phone: '(951) 555-0127',
    allProjects: true,
    projectAccess: [],
    role: 'ACCOUNTING',
    isActive: true,
    lastLoginAt: '2026-08-19T08:05:00',
  },
  {
    id: 3,
    name: 'Andres Salinas',
    email: 'andres.salinas@valtrim.com',
    phone: '(951) 555-0143',
    allProjects: false,
    projectAccess: ['ANDARA_P1', 'ANDARA_P2'],
    role: 'PROJECT_MANAGEMENT',
    isActive: true,
    lastLoginAt: '2026-08-17T11:20:00',
  },
  {
    id: 4,
    name: 'Priya Nair',
    email: 'priya.nair@valtrim.com',
    phone: '(951) 555-0158',
    allProjects: true,
    projectAccess: [],
    role: 'SCHEDULING',
    isActive: true,
    lastLoginAt: '2026-08-19T07:31:00',
  },
  {
    id: 5,
    name: 'Hector Ramos',
    email: 'hector.ramos@valtrim.com',
    phone: '(951) 555-0166',
    allProjects: false,
    projectAccess: ['ANDARA_P1'],
    role: 'FIELD',
    isActive: true,
    lastLoginAt: '2026-08-18T06:12:00',
  },
  {
    id: 6,
    name: 'Dwayne Fletcher',
    email: 'dwayne.fletcher@valtrim.com',
    phone: '(951) 555-0172',
    allProjects: false,
    projectAccess: ['STONEBROOK', 'SKY'],
    role: 'FIELD',
    isActive: true,
    lastLoginAt: null,
  },
  {
    id: 7,
    name: 'Karen Oyelaran',
    email: 'karen.oyelaran@valtrim.com',
    phone: '',
    allProjects: true,
    projectAccess: [],
    role: 'READ_ONLY',
    isActive: true,
    lastLoginAt: '2026-08-12T14:58:00',
  },
  {
    id: 8,
    name: 'Sofia Bianchi',
    email: 'sofia.bianchi@valtrim.com',
    phone: '(951) 555-0189',
    allProjects: true,
    projectAccess: [],
    role: 'ACCOUNTING',
    isActive: false,
    lastLoginAt: '2026-05-30T16:44:00',
  },
  {
    id: 9,
    name: 'Anelda Calvillo',
    email: 'anelda.calvillo@valtrim.com',
    phone: '(951) 555-0195',
    // Service requests come in from every community, so the coordinator who
    // works them is not scoped to a subset of projects.
    allProjects: true,
    projectAccess: [],
    // Closest role in the catalog to what she actually does, which is booking
    // technician visits. A dedicated Customer Service role is a permissions
    // decision that belongs with RLS.
    role: 'SCHEDULING',
    isActive: true,
    lastLoginAt: '2026-08-28T07:58:00',
  },
]
