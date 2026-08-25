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
]
