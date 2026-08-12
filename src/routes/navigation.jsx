import {
  BuildersPage,
  CalendarPage,
  DrawPage,
  FinancialsPage,
  HomePage,
  InvoicePage,
  PlanTypesPage,
  PricingPage,
} from './lazyPages.jsx'

// Single source of truth for the app's navigable routes.
// Both AppRoutes and the Sidebar read from here.
export const navigationRoutes = [
  { path: '/', label: 'Home', icon: 'home', element: <HomePage /> },
  { path: '/calendar', label: 'Calendar', icon: 'calendar', element: <CalendarPage /> },
  { path: '/draw', label: 'Draw', icon: 'draw', element: <DrawPage /> },
  { path: '/builders', label: 'Builders', icon: 'builders', element: <BuildersPage /> },
  { path: '/plan-types', label: 'Plan Types', icon: 'plan-types', element: <PlanTypesPage /> },
  { path: '/pricing', label: 'Pricing', icon: 'pricing', element: <PricingPage /> },
  { path: '/invoice', label: 'Invoice', icon: 'invoice', element: <InvoicePage /> },
  { path: '/financials', label: 'Financials', icon: 'financials', element: <FinancialsPage /> },

]
