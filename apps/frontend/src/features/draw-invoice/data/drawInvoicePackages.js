export const initialDrawInvoicePackages = [
  {
    id: 'draw-package-1',
    packageNumber: 'PKG-0001',
    jobId: 1,
    phaseId: 2102,
    lotIds: [3201, 3202, 3203, 3204, 3205],
    drawIndexes: [0],
    selections: [
      { lotId: 3201, drawIndex: 0 },
      { lotId: 3202, drawIndex: 0 },
      { lotId: 3203, drawIndex: 0 },
      { lotId: 3204, drawIndex: 0 },
      { lotId: 3205, drawIndex: 0 },
    ],
    invoiceNumber: '14645',
    invoiceDate: '2026-08-10',
    billingPeriodStart: '2026-08-01',
    billingPeriodEnd: '2026-08-10',
    status: 'INVOICED',
    documents: [
      { type: 'INVOICE', label: 'Invoice', status: 'COMPLETE' },
      { type: 'RELEASE', label: 'Release', status: 'COMPLETE' },
    ],
    quickbooksStatus: 'CREATED',
    submissionStatus: 'SUBMITTED',
    createdAt: '2026-08-07T12:00:00.000Z',
  },
]

