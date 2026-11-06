import { useContext } from 'react'
import { ProductionActivitiesContext } from './productionActivitiesContext.js'

export function useProductionActivities() {
  const context = useContext(ProductionActivitiesContext)
  if (!context) {
    throw new Error(
      'useProductionActivities must be used inside ProductionActivitiesProvider',
    )
  }
  return context
}
