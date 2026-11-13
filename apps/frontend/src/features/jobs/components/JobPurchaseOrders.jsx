import { lazy, Suspense, useMemo, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Backdrop,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import DocumentRow from '../../draw-invoice/components/documents/DocumentRow.jsx'
import { useJobDocuments } from '../../draw-invoice/hooks/useJobDocuments.js'
import { usePurchaseOrders } from '../../purchase-orders/hooks/usePurchaseOrders.js'
import {
  describePurchaseOrderDocument,
  purchaseOrderRowAction,
  purchaseOrdersOf,
} from '../../purchase-orders/services/purchaseOrderRecord.js'
import { useJobs } from '../context/useJobs.js'

const PurchaseOrderReviewDialog = lazy(
  () => import('../../purchase-orders/components/PurchaseOrderReviewDialog.jsx'),
)

/**
 * The Purchase Orders of a Job, on its page. Accounting uploads them in Draw & Invoice, but it is
 * Project Management who imports their Options and takes their prices, and that role does not
 * open Draw & Invoice, so the same review opens from here.
 */
export default function JobPurchaseOrders({ job }) {
  const { canManageJobs, refreshJobs } = useJobs()
  const [reviewing, setReviewing] = useState(null)
  // Only what the library reads from a Job, so a refreshed Job does not reload the documents.
  const libraryJobs = useMemo(
    () => [{ id: job.id, builderId: job.builderId, billingSetupVersionId: job.billingSetupVersionId }],
    [job.id, job.builderId, job.billingSetupVersionId],
  )
  const { documentsByJob, initialized, error, openJobDocument, openingDocumentId } = useJobDocuments(libraryJobs)
  const documents = useMemo(
    () => purchaseOrdersOf(documentsByJob[String(job.id)]),
    [documentsByJob, job.id],
  )
  const documentIds = useMemo(() => documents.map(({ id }) => id).sort(), [documents])
  const purchaseOrders = usePurchaseOrders(documentIds)
  const canManage = canManageJobs && job.isActive !== false

  // An import adds Options and a price changes one, so the Plans & Options on this page are read again.
  const closeReview = () => {
    if (reviewing && purchaseOrders.revision !== reviewing.revision) refreshJobs().catch(() => {})
    setReviewing(null)
  }

  return (
    <>
      <Accordion variant="outlined" disableGutters sx={{ mb: 2.5, '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} aria-controls="job-purchase-orders">
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 0.25, sm: 1.5 }}
            sx={{ minWidth: 0, alignItems: { sm: 'center' } }}
          >
            <Typography component="h2" variant="subtitle1" fontWeight={700}>
              Purchase Orders
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Compare them with this Job&apos;s Options and bring in what is missing.
            </Typography>
            {initialized && documents.length > 0 && (
              <Chip size="small" variant="outlined" label={documents.length} />
            )}
          </Stack>
        </AccordionSummary>
        <AccordionDetails id="job-purchase-orders" sx={{ p: 0 }}>
          {error && <Alert severity="error" sx={{ m: 1.5 }}>{error}</Alert>}
          {!initialized && !error && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 2 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">Loading Purchase Orders…</Typography>
            </Stack>
          )}
          {initialized && documents.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              This Job has no Purchase Orders yet. They are uploaded from Draw &amp; Invoice.
            </Typography>
          )}
          {documents.map((document) => {
            const analysis = purchaseOrders.analysesByDocumentId[document.id] ?? null
            const analyzing = purchaseOrders.analyzingDocumentId === document.id
            const { status, title } = describePurchaseOrderDocument(analysis, null, analyzing)

            return (
              <DocumentRow
                key={document.id}
                document={document}
                busyOpening={openingDocumentId === document.id}
                chips={status ? [{ label: status.label, color: status.color, title }] : []}
                primary={canManage || analysis
                  ? {
                    label: purchaseOrderRowAction(analysis),
                    ariaLabel: `Compare ${document.name} with the system`,
                    busy: analyzing,
                    onClick: () => setReviewing({ document, revision: purchaseOrders.revision }),
                  }
                  : null}
                onOpen={openJobDocument}
              />
            )
          })}
        </AccordionDetails>
      </Accordion>

      {reviewing && (
        <Suspense
          fallback={(
            <Backdrop open sx={{ zIndex: 'modal' }}>
              <CircularProgress color="inherit" />
            </Backdrop>
          )}
        >
          <PurchaseOrderReviewDialog
            key={reviewing.document.id}
            job={job}
            document={reviewing.document}
            purchaseOrders={purchaseOrders}
            canManage={canManage}
            onClose={closeReview}
          />
        </Suspense>
      )}
    </>
  )
}
