import { useContext } from 'react'
import { BuildersContext } from './buildersContext.js'

export function useBuilders() {
  const context = useContext(BuildersContext)

  if (!context) {
    throw new Error('useBuilders must be used inside BuildersProvider.')
  }

  return context
}
