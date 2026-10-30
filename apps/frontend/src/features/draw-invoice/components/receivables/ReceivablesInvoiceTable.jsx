import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { formatDate } from '../../utils/drawInvoiceFormatters.js'
import { BucketChip, InvoiceLink, SortHeader } from './receivablesUi.jsx'
import {
  BUCKET_COLORS,
  clickableRowSx,
  describeDaysPastDue,
  formatCents,
  tableHeadRowSx,
  tableSx,
  useOpenInvoice,
} from './receivablesView.js'

const COLUMN_WIDTHS = [150, 170, 120, 110, 110, 130, 130, 130, 110]
const MIN_WIDTH = COLUMN_WIDTHS.reduce((total, width) => total + width, 0)

function DaysPastDue({ invoice }) {
  const late = invoice.daysPastDue != null && invoice.daysPastDue > 0
  return late ? (
    <>
      <Typography fontWeight={850} sx={{ color: BUCKET_COLORS[invoice.bucket], fontVariantNumeric: 'tabular-nums' }}>
        {invoice.daysPastDue}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {describeDaysPastDue(invoice.daysPastDue)}
      </Typography>
    </>
  ) : (
    <Typography variant="body2" color="text.secondary">
      {describeDaysPastDue(invoice.daysPastDue)}
    </Typography>
  )
}

/** One row per open invoice: who owes it, how much, and how late it is. */
export default function ReceivablesInvoiceTable({
  invoices,
  sort,
  onSort,
}) {
  const header = { sort, onSort }
  const openInvoice = useOpenInvoice()

  return (
    <TableContainer>
      <Table size="small" aria-label="Open invoices by Invoice" sx={{ ...tableSx, minWidth: MIN_WIDTH }}>
        <colgroup>
          {COLUMN_WIDTHS.map((width, index) => <col key={index} style={{ width }} />)}
        </colgroup>
        <TableHead>
          <TableRow sx={tableHeadRowSx}>
            <SortHeader column="invoice" label="Invoice" {...header} />
            <SortHeader column="builder" label="Builder" {...header} />
            <SortHeader column="job" label="Job" {...header} />
            <SortHeader column="invoiceDate" label="Invoice Date" firstDirection="desc" {...header} />
            <SortHeader column="dueDate" label="Due Date" {...header} />
            <SortHeader column="original" label="Original" align="right" firstDirection="desc" {...header} />
            <SortHeader column="balance" label="Balance Due" align="right" firstDirection="desc" {...header} />
            <SortHeader column="daysPastDue" label="Days Past Due" align="right" firstDirection="desc" {...header} />
            <TableCell>Aging</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {invoices.map((invoice) => (
            <TableRow
              key={invoice.id}
              hover
              onClick={openInvoice(invoice)}
              sx={clickableRowSx}
            >
              <TableCell>
                <InvoiceLink invoice={invoice} />
                <Typography variant="caption" color="text.secondary" component="div" noWrap>
                  {invoice.packageNumber}
                </Typography>
              </TableCell>
              <TableCell sx={{ overflowWrap: 'anywhere' }}>{invoice.builderName}</TableCell>
              <TableCell sx={{ overflowWrap: 'anywhere' }}>{invoice.jobName}</TableCell>
              <TableCell>{formatDate(invoice.invoiceDate)}</TableCell>
              <TableCell>{formatDate(invoice.dueDate)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatCents(invoice.originalCents)}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 850, fontVariantNumeric: 'tabular-nums' }}>
                {formatCents(invoice.balanceCents)}
              </TableCell>
              <TableCell align="right"><DaysPastDue invoice={invoice} /></TableCell>
              <TableCell><BucketChip bucket={invoice.bucket} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
