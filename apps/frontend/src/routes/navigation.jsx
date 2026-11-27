import {
  CalendarPage,
  ChangeOrdersPage,
  NewChangeOrderPage,
  ChangeOrderDetailPage,
  EditChangeOrderPage,
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
  ActivityHistoryPage,
  HyphenRequestsPage,
} from './lazyPages.jsx'
import { ADMIN_ROLES, PAGE_ROLES } from '../features/auth/authorization/roleAccess.js'
import StartPageGate from '../features/auth/context/StartPageGate.jsx'
import { CHANGE_ORDERS_ENABLED } from '../config/appConfig.js'

// Who may open each page: the roles that work there, plus the observers
// (FIELD, READ_ONLY) who only look. Home has no list, so everyone opens it,
// except the roles that start on a page of their own (see StartPageGate).
const {
  planning: planningPage,
  changeOrders: changeOrdersPage,
  drawInvoice: drawInvoicePage,
  billing: billingPage,
  scheduling: schedulingPage,
  customerService: customerServicePage,
  admin: adminPage,
} = PAGE_ROLES

// Single source of truth for the app's navigable routes.
// Both AppRoutes and the Sidebar read from here.
const changeOrdersRoute = {
  path: '/change-orders',
  label: 'Extra / Change Orders',
  icon: 'change-orders',
  element: <ChangeOrdersPage />,
  allowedRoles: changeOrdersPage,
}

const changeOrdersContextualRoutes = [
  { path: '/change-orders/new', element: <NewChangeOrderPage />, allowedRoles: changeOrdersPage },
  // Draw & Invoice opens an Extra / CO from its Change Orders tab to see it and invoice it, and changes nothing
  // else of it. Scheduling works Extras / COs like Project Management (and opens one from a CO event of the Calendar).
  {
    path: '/change-orders/:changeOrderId',
    element: <ChangeOrderDetailPage />,
    allowedRoles: [...new Set([...changeOrdersPage, ...drawInvoicePage])],
  },
  { path: '/change-orders/:changeOrderId/edit', element: <EditChangeOrderPage />, allowedRoles: changeOrdersPage },
]

export const navigationRoutes = [
  {
    path: '/',
    label: 'Home',
    icon: 'home',
    element: <StartPageGate><HomePage /></StartPageGate>,
  },
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
    allowedRoles: drawInvoicePage,
  },
  ...(CHANGE_ORDERS_ENABLED ? [changeOrdersRoute] : []),
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
    path: '/history',
    label: 'Activity History',
    icon: 'activity-history',
    element: <ActivityHistoryPage />,
    allowedRoles: ['ADMIN'],
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
  {
    path: '/hyphen-requests',
    label: 'Hyphen Requests',
    icon: 'hyphen-requests',
    element: <HyphenRequestsPage />,
    allowedRoles: ADMIN_ROLES,
  },
  {
    path: '/customer-service/proposals',
    label: 'Customer Service Proposals',
    icon: 'customer-service',
    element: <CustomerServicePage />,
    allowedRoles: customerServicePage,
  },
  {
    path: '/customer-service/calendar',
    label: 'Customer Service Calendar',
    icon: 'customer-service',
    element: <CustomerServicePage />,
    allowedRoles: customerServicePage,
  },
  {
    path: '/customer-service/history',
    label: 'Customer Service History',
    icon: 'customer-service',
    element: <CustomerServicePage />,
    allowedRoles: customerServicePage,
  },

]

// Context routes keep the selected builder and Job in the URL while the
// sidebar continues to link to each module's general entry point. They answer
// to the same roles as the page they belong to.
export const contextualRoutes = [
  ...(CHANGE_ORDERS_ENABLED ? changeOrdersContextualRoutes : []),
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
    allowedRoles: drawInvoicePage,
  },
  {
    path: '/draw-invoice/builder/:builderId/job/:jobId/phase/:phaseId',
    element: <DrawAndInvoicePage />,
    allowedRoles: drawInvoicePage,
  },
  {
    path: '/draw-invoice/builder/:builderId/job/:jobId/phase/:phaseId/package/:packageId',
    element: <DrawAndInvoicePage />,
    allowedRoles: drawInvoicePage,
  },
]
