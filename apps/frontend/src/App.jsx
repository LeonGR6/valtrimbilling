import { RouterProvider } from 'react-router-dom'
import { appRouter } from './routes/AppRoutes.jsx'
import { JobsProvider } from './features/jobs/context/JobsContext.jsx'

export default function App() {
  return (
    <JobsProvider>
      <RouterProvider router={appRouter} />
    </JobsProvider>
  )
}
