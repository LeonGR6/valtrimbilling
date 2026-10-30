import { lazy, Suspense, useEffect, useState } from 'react'
import { Alert, Button, CircularProgress, Snackbar } from '@mui/material'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import {
  buildPackageBundleFileName,
  describeStoredBundle,
  hasGeneratedPackage,
} from '../../services/packageBundle.js'
import { buildStoredPackageBundle, listStoredPackageDocuments } from '../../services/storedPackageBundle.js'
import { loadPackagePurchaseOrders } from '../../services/packagePurchaseOrders.js'
import { joinableOrders } from '../../utils/packagePurchaseOrders.js'
import { packageDocumentNumber } from '../../utils/packageInvoiceLabel.js'
import { savePdfToDisk } from '../../../../utils/downloadFile.js'

const PdfPreviewDialog = lazy(() => import('../../../release-templates/components/PdfPreviewDialog.jsx'))

/**
 * Opens the Package that was already generated, without generating it again. It shows up only
 * once the Package has a saved Release or Payment Schedule, which is what generating it leaves
 * behind, and the PDF is the saved documents joined in the order they were joined the first time.
 * The Purchase Orders behind the options it charges (`optionRows`) are joined after them, as they are
 * when it is generated; they are the Job's, so they are looked up as they stand now.
 * `reloadKey` changes when something may have been generated, so the button looks again.
 */
export default function ViewGeneratedPackageButton({ packageRecord, job, optionRows = [], reloadKey = null }) {
  const packageId = packageRecord.id
  const lookup = `${packageId}:${reloadKey}`
  const [found, setFound] = useState({ lookup: null, documents: null })
  const [opening, setOpening] = useState(false)
  const [bundle, setBundle] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    listStoredPackageDocuments(packageId)
      .then((documents) => {
        if (!cancelled) setFound({ lookup, documents })
      })
      .catch(() => {
        // Only informs: without the list there is simply no button.
        if (!cancelled) setFound({ lookup, documents: null })
      })
    return () => {
      cancelled = true
    }
  }, [lookup, packageId])

  const documents = found.lookup === lookup ? found.documents : null
  if (!documents || !hasGeneratedPackage(documents)) return null

  const open = async () => {
    setOpening(true)
    setError(null)
    try {
      // The Purchase Orders are an addition: if they cannot be looked up, the saved documents still open.
      const purchaseOrders = optionRows.length === 0
        ? []
        : await loadPackagePurchaseOrders({ jobId: job.id, rows: optionRows })
          .then(joinableOrders)
          .catch(() => [])
      const built = await buildStoredPackageBundle(packageId, documents, { purchaseOrders })
      setBundle({
        ...built,
        fileName: buildPackageBundleFileName({
          jobCode: job.code,
          packageNumber: packageDocumentNumber(packageRecord),
        }),
      })
    } catch (openError) {
      setError(openError.message || 'The generated Package could not be opened.')
    } finally {
      setOpening(false)
    }
  }

  return (
    <>
      <Button
        variant="outlined"
        color="inherit"
        startIcon={opening ? <CircularProgress size={16} color="inherit" /> : <VisibilityRoundedIcon />}
        onClick={open}
        disabled={opening}
      >
        {opening ? 'Opening…' : 'View generated package'}
      </Button>

      {bundle && (
        <Suspense fallback={null}>
          <PdfPreviewDialog
            title="Package"
            subtitle={bundle.fileName}
            statusNote={describeStoredBundle(bundle.parts)}
            bytes={bundle.bytes}
            onDownload={() => savePdfToDisk(bundle.bytes, bundle.fileName)}
            onClose={() => setBundle(null)}
          />
        </Suspense>
      )}

      <Snackbar
        open={Boolean(error)}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="error" variant="filled" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
    </>
  )
}
