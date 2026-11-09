export const APP_NAME = 'ValtrimBilling'
export const DEFAULT_ROUTE = '/'
export const MANUAL_SIGN_OUT_STORAGE_KEY = 'valtrimbilling.auth.manual-sign-out'

// The Extra / Change Orders pages are built but closed in the deployed app: no route, and the sidebar
// entry shows as not available. They are open on localhost (npm run dev), and set to true they open
// everywhere.
export const CHANGE_ORDERS_ENABLED = Boolean(import.meta.env?.DEV)
