import { RouterProvider } from 'react-router-dom'
import { appRouter } from './routes/AppRoutes.jsx'
import { JobsProvider } from './features/jobs/context/JobsContext.jsx'
import { BuilderDrawSchedulesProvider } from './features/builder-draw-schedules/context/BuilderDrawSchedulesContext.jsx'
import { DrawInvoicePackagesProvider } from './features/draw-invoice/context/DrawInvoicePackagesContext.jsx'
import { BuildersProvider } from './features/builders/context/BuildersContext.jsx'

export default function App() {
  return (
    <BuildersProvider>
      <JobsProvider>
        <BuilderDrawSchedulesProvider>
          <DrawInvoicePackagesProvider>
            <RouterProvider router={appRouter} />
          </DrawInvoicePackagesProvider>
        </BuilderDrawSchedulesProvider>
      </JobsProvider>
    </BuildersProvider>
  )
}
