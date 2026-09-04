import {
  CalendarPage,
  BuilderDrawSchedulesPage,
  FinancialsPage,
  HomePage,
  InvoicePage,
  JobsPage,
  DrawAndInvoicePage,
  PeoplePage,
  PricingPage,
  SequenceSheetsPage,
  BuilderContactsPage,
  CustomerServicePage,
  UsersPage,
} from './lazyPages.jsx'

// Single source of truth for the app's navigable routes.
// Both AppRoutes and the Sidebar read from here.
export const navigationRoutes = [
  { path: '/', label: 'Home', icon: 'home', element: <HomePage /> },
  { path: '/calendar', label: 'Calendar', icon: 'calendar', element: <CalendarPage /> },
  { path: '/jobs', label: 'Jobs', icon: 'jobs', element: <JobsPage /> },
  { path: '/sequence-sheets', label: 'Sequence Sheets', icon: 'sequence-sheets', element: <SequenceSheetsPage /> },
  { path: '/draw-invoice', label: 'Draw & Invoice', icon: 'draw-invoice', element: <DrawAndInvoicePage /> },
  {
    path: '/builder-draw-schedules',
    label: 'Builder Draw Schedules',
    icon: 'builder-draw-schedules',
    element: <BuilderDrawSchedulesPage />,
  },
  { path: '/people', label: 'People', icon: 'people', element: <PeoplePage /> },
  { path: '/pricing', label: 'Pricing', icon: 'pricing', element: <PricingPage /> },
  { path: '/invoice', label: 'Invoice', icon: 'invoice', element: <InvoicePage /> },
  { path: '/financials', label: 'Financials', icon: 'financials', element: <FinancialsPage /> },
  { path: '/users', label: 'Users', icon: 'users', element: <UsersPage /> },
  { path: '/builder-contacts', label: 'Builder Contacts', icon: 'builder-contacts', element: <BuilderContactsPage /> },
  { path: '/customer-service', label: 'Customer Service', icon: 'customer-service', element: <CustomerServicePage /> },

]

// Context routes keep the selected builder and Job in the URL while the
// sidebar continues to link to each module's general entry point.
export const contextualRoutes = [
  { path: '/jobs/builder/:builderId', element: <JobsPage /> },
  {
    path: '/jobs/builder/:builderId/job/:jobId/plans-options',
    element: <JobsPage />,
  },
  {
    path: '/sequence-sheets/builder/:builderId/job/:jobId',
    element: <SequenceSheetsPage />,
  },
  {
    path: '/sequence-sheets/builder/:builderId/job/:jobId/phase/:phaseId',
    element: <SequenceSheetsPage />,
  },
  {
    path: '/pricing/builder/:builderId/job/:jobId',
    element: <PricingPage />,
  },
  {
    path: '/draw-invoice/builder/:builderId/job/:jobId',
    element: <DrawAndInvoicePage />,
  },
  {
    path: '/draw-invoice/builder/:builderId/job/:jobId/phase/:phaseId',
    element: <DrawAndInvoicePage />,
  },
  {
    path: '/draw-invoice/builder/:builderId/job/:jobId/phase/:phaseId/package/:packageId',
    element: <DrawAndInvoicePage />,
  },
]
