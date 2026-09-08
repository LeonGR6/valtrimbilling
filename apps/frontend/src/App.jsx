import { RouterProvider } from 'react-router-dom'
import { appRouter } from './routes/AppRoutes.jsx'
import { JobsProvider } from './features/jobs/context/JobsContext.jsx'
import { BuilderDrawSchedulesProvider } from './features/builder-draw-schedules/context/BuilderDrawSchedulesContext.jsx'
import { DrawInvoicePackagesProvider } from './features/draw-invoice/context/DrawInvoicePackagesContext.jsx'
import { BuildersProvider } from './features/builders/context/BuildersContext.jsx'
import { PeopleProvider } from './features/people/context/PeopleContext.jsx'
import { BuilderContactsProvider } from './features/builder-contacts/context/BuilderContactsContext.jsx'
import { AuthProvider } from './features/auth/context/AuthProvider.jsx'

export default function App() {
  return (
    <AuthProvider>
      <BuildersProvider>
        <PeopleProvider>
          <BuilderContactsProvider>
            <JobsProvider>
              <BuilderDrawSchedulesProvider>
                <DrawInvoicePackagesProvider>
                  <RouterProvider router={appRouter} />
                </DrawInvoicePackagesProvider>
              </BuilderDrawSchedulesProvider>
            </JobsProvider>
          </BuilderContactsProvider>
        </PeopleProvider>
      </BuildersProvider>
    </AuthProvider>
  )
}
