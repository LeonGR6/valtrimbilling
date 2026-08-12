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
import { navigationRoutes } from './navigation.jsx'

export const appRouter = createBrowserRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<RouteLoading />}>
        <AppLayout />
      </Suspense>
    ),
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to={DEFAULT_ROUTE} replace /> },
      ...navigationRoutes.map(({ path, element }) => ({ path: path.slice(1), element })),
      { path: '*', element: <NotFound /> },
    ],
  },
])
