import { RouterProvider } from 'react-router-dom'
import { appRouter } from './routes/AppRoutes.jsx'
import { JobsProvider } from './features/jobs/context/JobsContext.jsx'
import { BuilderDrawSchedulesProvider } from './features/builder-draw-schedules/context/BuilderDrawSchedulesContext.jsx'

export default function App() {
  return (
    <JobsProvider>
      <BuilderDrawSchedulesProvider>
        <RouterProvider router={appRouter} />
      </BuilderDrawSchedulesProvider>
    </JobsProvider>
  )
}
