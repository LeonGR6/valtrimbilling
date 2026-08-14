import { RouterProvider } from 'react-router-dom'
import { appRouter } from './routes/AppRoutes.jsx'

export default function App() {
  return <RouterProvider router={appRouter} />
}
