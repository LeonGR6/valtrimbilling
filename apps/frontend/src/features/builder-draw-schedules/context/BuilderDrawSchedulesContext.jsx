import { useMemo, useState } from 'react'
import { initialBuilderDrawSchedules } from '../data/builderDrawSchedules.js'
import { BuilderDrawSchedulesContext } from './builderDrawSchedulesContext.js'

export function BuilderDrawSchedulesProvider({ children }) {
  const [builderDrawSchedules, setBuilderDrawSchedules] = useState(
    initialBuilderDrawSchedules,
  )
  const value = useMemo(
    () => ({ builderDrawSchedules, setBuilderDrawSchedules }),
    [builderDrawSchedules],
  )

  return (
    <BuilderDrawSchedulesContext.Provider value={value}>
      {children}
    </BuilderDrawSchedulesContext.Provider>
  )
}
