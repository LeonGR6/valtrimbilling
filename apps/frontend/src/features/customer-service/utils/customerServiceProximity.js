// Nearby-visit rules live with the Edge Functions so the server can use the same
// distance bands; Vite bundles the same pure module for the browser.
export * from '../../../../../backend/supabase/functions/_shared/customerServiceProximity.mjs'
