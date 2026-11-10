export const APP_NAME = 'ValtrimBilling'
export const DEFAULT_ROUTE = '/'
export const MANUAL_SIGN_OUT_STORAGE_KEY = 'valtrimbilling.auth.manual-sign-out'

// The address people open the app at. Invitation emails always send the new user here, even when the
// admin sends the invitation from localhost or a preview deploy. VITE_PUBLIC_APP_URL overrides it.
export const PUBLIC_APP_URL = (import.meta.env?.VITE_PUBLIC_APP_URL?.trim() || 'https://valtrimbilling.vercel.app')
  .replace(/\/+$/, '')

// The Extra / Change Orders pages are built but closed in the deployed app: no route, and the sidebar
// entry shows as not available. They are open on localhost (npm run dev), and set to true they open
// everywhere.
export const CHANGE_ORDERS_ENABLED = Boolean(import.meta.env?.DEV)
