import { lazy } from 'react'

export const BuildersPage = lazy(() => import('../pages/Builders'))
export const CalendarPage = lazy(() => import('../pages/Calendar'))
export const DrawPage = lazy(() => import('../pages/Draw'))
export const FinancialsPage = lazy(() => import('../pages/Financials'))
export const HomePage = lazy(() => import('../pages/Home'))
export const InvoicePage = lazy(() => import('../pages/Invoice'))
export const PlanTypesPage = lazy(() => import('../pages/PlanTypes'))
export const PricingPage = lazy(() => import('../pages/Pricing'))

export const LoginPage = lazy(() => import('../pages/Auth/Login'))
export const ForgotPasswordPage = lazy(() => import('../pages/Auth/ForgotPassword'))
export const ResetPasswordPage = lazy(() => import('../pages/Auth/ResetPassword'))
