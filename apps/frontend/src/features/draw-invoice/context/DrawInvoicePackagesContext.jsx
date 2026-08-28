import { useMemo, useRef, useState } from 'react'
import { initialDrawInvoicePackages } from '../data/drawInvoicePackages.js'
import { makePackageSelections } from '../utils/drawPackages.js'
import { DrawInvoicePackagesContext } from './drawInvoicePackagesContext.js'

function requiredDocumentsForSchedule(schedule) {
  return [
    { type: 'INVOICE', label: 'Invoice', status: 'MISSING' },
    schedule?.requiresRelease
      ? { type: 'RELEASE', label: 'Release', status: 'MISSING' }
      : null,
    schedule?.requiresPaymentSchedule
      ? {
          type: 'PAYMENT_SCHEDULE',
          label: 'Payment schedule',
          status: 'MISSING',
        }
      : null,
    schedule?.requiresBackup
      ? { type: 'BACKUP', label: 'Backup', status: 'MISSING' }
      : null,
  ].filter(Boolean)
}

export function DrawInvoicePackagesProvider({ children }) {
  const [drawInvoicePackages, setDrawInvoicePackages] = useState(
    initialDrawInvoicePackages,
  )
  const nextSequence = useRef(initialDrawInvoicePackages.length + 1)

  const value = useMemo(
    () => ({
      drawInvoicePackages,
      createDrawInvoicePackage({
        jobId,
        phaseId,
        lotIds,
        drawIndexes,
        schedule,
      }) {
        const sequence = nextSequence.current
        nextSequence.current += 1
        const now = new Date().toISOString()
        const record = {
          id: `draw-package-${sequence}`,
          packageNumber: `PKG-${String(sequence).padStart(4, '0')}`,
          jobId,
          phaseId,
          lotIds: [...lotIds],
          drawIndexes: [...drawIndexes],
          selections: makePackageSelections(lotIds, drawIndexes),
          invoiceNumber: null,
          invoiceDate: null,
          billingPeriodStart: null,
          billingPeriodEnd: null,
          status: 'DRAFT',
          documents: requiredDocumentsForSchedule(schedule),
          quickbooksStatus: 'NOT_CREATED',
          submissionStatus: 'NOT_SUBMITTED',
          createdAt: now,
        }

        setDrawInvoicePackages((current) => [record, ...current])
        return record
      },
    }),
    [drawInvoicePackages],
  )

  return (
    <DrawInvoicePackagesContext.Provider value={value}>
      {children}
    </DrawInvoicePackagesContext.Provider>
  )
}

