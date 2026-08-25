import {
  BuildersPage,
  CalendarPage,
  DrawPage,
  FinancialsPage,
  HomePage,
  InvoicePage,
  JobsPage,
  PeoplePage,
  PlanTypesPage,
  PricingPage,
  SequenceSheetsPage,
  BillingProfilesPage,
  BuilderContactsPage,
  UsersPage,
} from './lazyPages.jsx'

// Single source of truth for the app's navigable routes.
// Both AppRoutes and the Sidebar read from here.
export const navigationRoutes = [
  { path: '/', label: 'Home', icon: 'home', element: <HomePage /> },
  { path: '/calendar', label: 'Calendar', icon: 'calendar', element: <CalendarPage /> },
  { path: '/jobs', label: 'Jobs', icon: 'jobs', element: <JobsPage /> },
  { path: '/sequence-sheets', label: 'Sequence Sheets', icon: 'sequence-sheets', element: <SequenceSheetsPage /> },
  { path: '/draw', label: 'Draw', icon: 'draw', element: <DrawPage /> },
  { path: '/builders', label: 'Builders', icon: 'builders', element: <BuildersPage /> },
  { path: '/people', label: 'People', icon: 'people', element: <PeoplePage /> },
  { path: '/plan-types', label: 'Plan Types', icon: 'plan-types', element: <PlanTypesPage /> },
  { path: '/pricing', label: 'Pricing', icon: 'pricing', element: <PricingPage /> },
  { path: '/invoice', label: 'Invoice', icon: 'invoice', element: <InvoicePage /> },
  { path: '/financials', label: 'Financials', icon: 'financials', element: <FinancialsPage /> },
  { path: '/users', label: 'Users', icon: 'users', element: <UsersPage /> },
  { path: '/billing-profiles', label: 'Billing Profiles', icon: 'billing-profiles', element: <BillingProfilesPage /> },
  { path: '/builder-contacts', label: 'Builder Contacts', icon: 'builder-contacts', element: <BuilderContactsPage /> },

]
