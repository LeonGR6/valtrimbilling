import Calendar from '../pages/Calendar'
import Draw from '../pages/Draw'
import Builders from '../pages/Builders'
import Pricing from '../pages/Pricing'
import Invoice from '../pages/Invoice'
import Financials from '../pages/Financials'

// Single source of truth for the app's navigable routes.
// Both the router (routes/index.jsx) and the Sidebar read from here.
export const routes = [
  { path: '/calendar', label: 'Calendar', icon: 'calendar', element: <Calendar /> },
  { path: '/draw', label: 'Draw', icon: 'draw', element: <Draw /> },
  { path: '/builders', label: 'Builders', icon: 'builders', element: <Builders /> },
  { path: '/pricing', label: 'Pricing', icon: 'pricing', element: <Pricing /> },
  { path: '/invoice', label: 'Invoice', icon: 'invoice', element: <Invoice /> },
  { path: '/financials', label: 'Financials', icon: 'financials', element: <Financials /> },
]
