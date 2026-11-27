import { Suspense } from 'react'
import {
  createBrowserRouter,
} from 'react-router-dom'
import RouteLoading from '../components/common/RouteLoading'
import AppLayout from '../components/layout/AppLayout'
import ErrorPage from '../pages/ErrorPage'
import NotFound from '../pages/NotFound'
import { contextualRoutes, navigationRoutes } from './navigation.jsx'
import {
  AcceptInvitePage,
  BuilderFollowUpResponsePage,
  CustomerProposalResponsePage,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
} from './lazyPages.jsx'
import RequireAuth from '../features/auth/context/RequireAuth.jsx'
import RequireRole from '../features/auth/context/RequireRole.jsx'
import CustomerServicePrototypeProvider from '../features/customer-service/context/CustomerServicePrototypeProvider.jsx'

function withRoleAccess(element, allowedRoles) {
  if (!allowedRoles?.length) return element
  return <RequireRole allowedRoles={allowedRoles}>{element}</RequireRole>
}

export const appRouter = createBrowserRouter([
  {
    path: '/login',
    element: <Suspense fallback={<RouteLoading />}><LoginPage /></Suspense>,
  },
  {
    path: '/forgot-password',
    element: <Suspense fallback={<RouteLoading />}><ForgotPasswordPage /></Suspense>,
  },
  {
    path: '/reset-password',
    element: <Suspense fallback={<RouteLoading />}><ResetPasswordPage /></Suspense>,
  },
  {
    path: '/accept-invite',
    element: <Suspense fallback={<RouteLoading />}><AcceptInvitePage /></Suspense>,
  },
  {
    path: '/follow-up/respond',
    element: <Suspense fallback={<RouteLoading />}><BuilderFollowUpResponsePage /></Suspense>,
  },
  {
    // A customer's answer to a Customer Service proposal; no sign-in (step B5).
    path: '/customer-service/respond',
    element: <Suspense fallback={<RouteLoading />}><CustomerProposalResponsePage /></Suspense>,
  },
  {
    path: '/',
    element: (
      <Suspense fallback={<RouteLoading />}>
        <RequireAuth>
          <CustomerServicePrototypeProvider>
            <AppLayout />
          </CustomerServicePrototypeProvider>
        </RequireAuth>
      </Suspense>
    ),
    errorElement: <ErrorPage />,
    children: [
      ...navigationRoutes.map(({ path, element, allowedRoles }) => ({
        ...(path === '/' ? { index: true } : { path: path.slice(1) }),
        element: withRoleAccess(element, allowedRoles),
      })),
      ...contextualRoutes.map(({ path, element, allowedRoles }) => ({
        path: path.slice(1),
        element: withRoleAccess(element, allowedRoles),
      })),
      { path: '*', element: <NotFound /> },
    ],
  },
])
