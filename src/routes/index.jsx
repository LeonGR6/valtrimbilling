import {
  createBrowserRouter,
  Navigate,
} from 'react-router-dom'
import Layout from '../components/layout/Layout'
import NotFound from '../pages/errors/NotFound'
import ErrorPage from '../pages/errors/ErrorPage'
import { routes } from './nav.jsx'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to="/calendar" replace /> },
      ...routes.map(({ path, element }) => ({ path: path.slice(1), element })),
      { path: '*', element: <NotFound /> },
    ],
  },
])
