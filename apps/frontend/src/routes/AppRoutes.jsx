import { Suspense } from 'react'
import {
  createBrowserRouter,
  Navigate,
} from 'react-router-dom'
import RouteLoading from '../components/common/RouteLoading'
import AppLayout from '../components/layout/AppLayout'
import ErrorPage from '../pages/ErrorPage'
import NotFound from '../pages/NotFound'
import { DEFAULT_ROUTE } from '../config/appConfig.js'
import { contextualRoutes, navigationRoutes } from './navigation.jsx'
import { LoginPage, ForgotPasswordPage, ResetPasswordPage } from './lazyPages.jsx'
import RequireAuth from '../features/auth/context/RequireAuth.jsx'

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
      { index: true, element: <Navigate to={DEFAULT_ROUTE} replace /> },
      ...navigationRoutes.map(({ path, element }) => ({ path: path.slice(1), element })),
      ...contextualRoutes.map(({ path, element }) => ({ path: path.slice(1), element })),
      { path: '*', element: <NotFound /> },
    ],
  },
])
