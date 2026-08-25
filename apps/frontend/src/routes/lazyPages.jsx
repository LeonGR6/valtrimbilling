import { lazy } from 'react'

export const CalendarPage = lazy(() => import('../pages/Calendar'))
export const BuilderDrawSchedulesPage = lazy(() => import('../pages/BuilderDrawSchedules'))
export const FinancialsPage = lazy(() => import('../pages/Financials'))
export const HomePage = lazy(() => import('../pages/Home'))
export const InvoicePage = lazy(() => import('../pages/Invoice'))
export const JobsPage = lazy(() => import('../pages/Jobs'))
export const PeoplePage = lazy(() => import('../pages/People'))
export const PricingPage = lazy(() => import('../pages/Pricing'))
export const SequenceSheetsPage = lazy(() => import('../pages/SequenceSheets'))
export const DrawAndInvoicePage = lazy(() => import('../pages/DrawAndInvoice'))

export const LoginPage = lazy(() => import('../pages/Auth/Login'))
export const ForgotPasswordPage = lazy(() => import('../pages/Auth/ForgotPassword'))
export const ResetPasswordPage = lazy(() => import('../pages/Auth/ResetPassword'))
