import {
  CalendarPage,
  ChangeOrdersPage,
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
import { ADMIN_ROLES, PAGE_ROLES } from '../features/auth/authorization/roleAccess.js'

// Who may open each page: the roles that work there, plus the observers
// (FIELD, READ_ONLY) who only look. Home has no list, so everyone opens it.
const {
  planning: planningPage,
  billing: billingPage,
  scheduling: schedulingPage,
  customerService: customerServicePage,
  admin: adminPage,
} = PAGE_ROLES

// Single source of truth for the app's navigable routes.
// Both AppRoutes and the Sidebar read from here.
export const navigationRoutes = [
  { path: '/', label: 'Home', icon: 'home', element: <HomePage /> },
  {
    path: '/calendar',
    label: 'Calendar',
    icon: 'calendar',
    element: <CalendarPage />,
    allowedRoles: schedulingPage,
  },
  { path: '/jobs', label: 'Jobs', icon: 'jobs', element: <JobsPage />, allowedRoles: planningPage },
  {
    path: '/sequence-sheets',
    label: 'Sequence Sheets',
    icon: 'sequence-sheets',
    element: <SequenceSheetsPage />,
    allowedRoles: schedulingPage,
  },
  {
    path: '/draw-invoice',
    label: 'Draw & Invoice',
    icon: 'draw-invoice',
    element: <DrawAndInvoicePage />,
    allowedRoles: billingPage,
  },
  {
    path: '/change-orders',
    label: 'Extra / Change Orders',
    icon: 'change-orders',
    element: <ChangeOrdersPage />,
    allowedRoles: planningPage,
  },
  {
    path: '/builder-draw-schedules',
    label: 'Builder Setup',
    icon: 'builder-draw-schedules',
    element: <BuilderDrawSchedulesPage />,
    allowedRoles: billingPage,
  },
  { path: '/people', label: 'People', icon: 'people', element: <PeoplePage />, allowedRoles: adminPage },
  { path: '/pricing', label: 'Pricing', icon: 'pricing', element: <PricingPage />, allowedRoles: planningPage },
  { path: '/invoice', label: 'Invoice', icon: 'invoice', element: <InvoicePage />, allowedRoles: adminPage },
  {
    path: '/financials',
    label: 'Financials',
    icon: 'financials',
    element: <FinancialsPage />,
    allowedRoles: adminPage,
  },
  {
    path: '/users',
    label: 'Users',
    icon: 'users',
    element: <UsersPage />,
    allowedRoles: ADMIN_ROLES,
  },
  {
    path: '/builder-contacts',
    label: 'Builder Contacts',
    icon: 'builder-contacts',
    element: <BuilderContactsPage />,
    allowedRoles: adminPage,
  },
  {
    path: '/customer-service',
    label: 'Customer Service',
    icon: 'customer-service',
    element: <CustomerServicePage />,
    allowedRoles: customerServicePage,
  },

]

// Context routes keep the selected builder and Job in the URL while the
// sidebar continues to link to each module's general entry point. They answer
// to the same roles as the page they belong to.
export const contextualRoutes = [
  { path: '/jobs/builder/:builderId', element: <JobsPage />, allowedRoles: planningPage },
  {
    path: '/jobs/builder/:builderId/job/:jobId/plans-options',
    element: <JobsPage />,
    allowedRoles: planningPage,
  },
  {
    path: '/sequence-sheets/builder/:builderId/job/:jobId',
    element: <SequenceSheetsPage />,
    allowedRoles: schedulingPage,
  },
  {
    path: '/sequence-sheets/builder/:builderId/job/:jobId/phase/:phaseId',
    element: <SequenceSheetsPage />,
    allowedRoles: schedulingPage,
  },
  {
    path: '/pricing/builder/:builderId/job/:jobId',
    element: <PricingPage />,
    allowedRoles: planningPage,
  },
  {
    path: '/draw-invoice/builder/:builderId/job/:jobId',
    element: <DrawAndInvoicePage />,
    allowedRoles: billingPage,
  },
  {
    path: '/draw-invoice/builder/:builderId/job/:jobId/phase/:phaseId',
    element: <DrawAndInvoicePage />,
    allowedRoles: billingPage,
  },
  {
    path: '/draw-invoice/builder/:builderId/job/:jobId/phase/:phaseId/package/:packageId',
    element: <DrawAndInvoicePage />,
    allowedRoles: billingPage,
  },
]
