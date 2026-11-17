import { comparePurchaseOrders, listPurchaseOrderFiles } from '../../purchase-orders/services/purchaseOrderRepository.js'
import { downloadStoredPdf } from '../../release-templates/services/packageReleaseRepository.js'
import { planPackagePurchaseOrders } from '../utils/packagePurchaseOrders.js'

/**
 * The Purchase Orders behind the options a Package charges, with their PDFs located, and the
 * options no Purchase Order backs well. `rows` are the options the Package charges now.
 */
export async function loadPackagePurchaseOrders({ jobId, rows }) {
  const lines = await comparePurchaseOrders(jobId)
  const documentIds = [...new Set(lines.filter((line) => line.lotId !== null).map((line) => line.documentId))]
  const files = await listPurchaseOrderFiles(documentIds)
  return planPackagePurchaseOrders({ rows, lines, files })
}

/** The PDF of one Purchase Order, read through the signed-in session. */
export async function downloadPurchaseOrderPdf(order) {
  const file = await downloadStoredPdf(order.file)
  return new Uint8Array(await file.arrayBuffer())
}
