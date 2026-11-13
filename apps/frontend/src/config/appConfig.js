export const APP_NAME = 'ValtrimBilling'
export const DEFAULT_ROUTE = '/'
export const MANUAL_SIGN_OUT_STORAGE_KEY = 'valtrimbilling.auth.manual-sign-out'

// The address people open the app at. Invitation emails always send the new user here, even when the
// admin sends the invitation from localhost or a preview deploy. VITE_PUBLIC_APP_URL overrides it.
export const PUBLIC_APP_URL = (import.meta.env?.VITE_PUBLIC_APP_URL?.trim() || 'https://valtrimbilling.vercel.app')
  .replace(/\/+$/, '')

// The Extra / Change Orders pages (routes, sidebar entry and the "CO" tabs) are open everywhere.
// Set to false to close them again.
export const CHANGE_ORDERS_ENABLED = true
