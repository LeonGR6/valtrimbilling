import { useContext } from 'react'
import { DrawInvoicePackagesContext } from './drawInvoicePackagesContext.js'

export function useDrawInvoicePackages() {
  const context = useContext(DrawInvoicePackagesContext)

  if (!context) {
    throw new Error(
      'useDrawInvoicePackages must be used inside DrawInvoicePackagesProvider',
    )
  }

  return context
}

