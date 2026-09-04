import { useCallback, useMemo, useState } from 'react'
import {
  initialBuilders,
  normalizeBuilderDateConfiguration,
  withDefaultBuilderDateConfiguration,
} from '../data/builders.js'
import { BuildersContext } from './buildersContext.js'

export function BuildersProvider({ children }) {
  const [builders, setBuilders] = useState(
    () => initialBuilders.map(withDefaultBuilderDateConfiguration),
  )

  const updateBuilderDateConfiguration = useCallback((builderId, configuration) => {
    setBuilders((current) => current.map((builder) => (
      builder.id === builderId
        ? {
          ...builder,
          calendarDateConfiguration: normalizeBuilderDateConfiguration(configuration),
        }
        : builder
    )))
  }, [])

  const value = useMemo(() => ({
    builders,
    setBuilders,
    updateBuilderDateConfiguration,
  }), [builders, updateBuilderDateConfiguration])

  return <BuildersContext.Provider value={value}>{children}</BuildersContext.Provider>
}
