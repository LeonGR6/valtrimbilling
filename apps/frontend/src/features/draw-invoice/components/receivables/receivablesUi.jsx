import { Chip, Link, TableCell, TableSortLabel } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { BUCKET_COLORS, BUCKET_SHORT_LABELS, invoicePath } from './receivablesView.js'

export function BucketChip({ bucket }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={BUCKET_SHORT_LABELS[bucket]}
      sx={{
        fontWeight: 750,
        color: BUCKET_COLORS[bucket],
        borderColor: BUCKET_COLORS[bucket],
      }}
    />
  )
}

/** The invoice number, opening the Package it belongs to. */
export function InvoiceLink({ invoice }) {
  return (
    <Link
      component={RouterLink}
      to={invoicePath(invoice)}
      underline="hover"
      fontWeight={800}
      aria-label={`Open Package ${invoice.packageNumber}, invoice ${invoice.invoiceNumber}`}
    >
      {invoice.invoiceNumber}
    </Link>
  )
}

export function SortHeader({ column, label, sort, onSort, firstDirection = 'asc', align = 'left' }) {
  const active = sort?.key === column
  const direction = active ? sort.direction : firstDirection

  return (
    <TableCell align={align} sortDirection={active ? direction : false}>
      <TableSortLabel
        active={active}
        direction={direction}
        onClick={() => onSort(column, firstDirection)}
        sx={{
          color: 'inherit !important',
          '& .MuiTableSortLabel-icon': {
            color: 'inherit !important',
            opacity: active ? 1 : 0.4,
          },
        }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  )
}
