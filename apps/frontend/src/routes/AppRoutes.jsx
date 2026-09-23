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
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
} from './lazyPages.jsx'
import RequireAuth from '../features/auth/context/RequireAuth.jsx'
import RequireRole from '../features/auth/context/RequireRole.jsx'

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
    path: '/',
    element: (
      <Suspense fallback={<RouteLoading />}>
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      </Suspense>
    ),
    errorElement: <ErrorPage />,
    children: [
      ...navigationRoutes.map(({ path, element, allowedRoles }) => ({
        ...(path === '/' ? { index: true } : { path: path.slice(1) }),
        element: withRoleAccess(element, allowedRoles),
      })),
      ...contextualRoutes.map(({ path, element }) => ({ path: path.slice(1), element })),
      { path: '*', element: <NotFound /> },
    ],
  },
])
