import { useParams } from 'react-router-dom'
import DrawInvoiceCatalog from './catalog/DrawInvoiceCatalog.jsx'
import DrawPackageDetail from './detail/DrawPackageDetail.jsx'

export default function DrawAndInvoicePackages() {
  const { jobId } = useParams()

  return jobId == null
    ? <DrawInvoiceCatalog />
    : <DrawPackageDetail />
}
