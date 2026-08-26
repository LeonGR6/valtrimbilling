import { useContext } from 'react'
import { BuilderDrawSchedulesContext } from './builderDrawSchedulesContext.js'

export function useBuilderDrawSchedules() {
  const context = useContext(BuilderDrawSchedulesContext)

  if (!context) {
    throw new Error(
      'useBuilderDrawSchedules must be used within BuilderDrawSchedulesProvider.',
    )
  }

  return context
}
