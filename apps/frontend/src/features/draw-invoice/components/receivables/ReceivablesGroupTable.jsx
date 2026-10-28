import { Fragment, useState } from 'react'
import {
  Box,
  ButtonBase,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import { formatDate } from '../../utils/drawInvoiceFormatters.js'
import {
  AGING_BUCKETS,
  DEFAULT_GROUP_SORT,
  groupReceivables,
  sortReceivableGroups,
  sortReceivableInvoices,
} from '../../utils/receivablesAging.js'
import { InvoiceLink, SortHeader } from './receivablesUi.jsx'
import {
  BUCKET_COLORS,
  clickableRowSx,
  describeDaysPastDue,
  formatCents,
  tableHeadRowSx,
  tableSx,
  useOpenInvoice,
} from './receivablesView.js'

const COLUMN_WIDTHS = [250, 170, 118, 118, 118, 118, 134, 140]
const MIN_WIDTH = COLUMN_WIDTHS.reduce((total, width) => total + width, 0)

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

// Each level sits a little further in, so the Builder → Job → Invoice chain reads at a glance.
// (Set on what is inside the cell: the table's own cell padding would win over the cell's.)
const indent = (depth) => ({ ml: depth * 3 })
const nestedRowSx = (depth) => ({
  bgcolor: depth === 0 ? undefined : depth === 1 ? 'action.hover' : 'background.default',
})

/** An amount in one bucket: a button that lists the invoices behind it, or a dash when nothing is owed. */
function BucketAmounts({ buckets, target, onDrill }) {
  return AGING_BUCKETS.map(({ key, label }) => (
    <TableCell key={key} align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
      {buckets[key] > 0 ? (
        <ButtonBase
          onClick={() => onDrill({ ...target, bucket: key })}
          aria-label={`Show the invoices behind ${formatCents(buckets[key])} in ${label}`}
          title="Show these invoices"
          sx={{
            font: 'inherit',
            fontWeight: 700,
            borderRadius: 1,
            px: 0.5,
            '&:hover': { textDecoration: 'underline' },
            '&.Mui-focusVisible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main' },
          }}
        >
          {formatCents(buckets[key])}
        </ButtonBase>
      ) : (
        <Typography component="span" color="text.disabled">—</Typography>
      )}
    </TableCell>
  ))
}

function InvoiceRow({ invoice, depth }) {
  const openInvoice = useOpenInvoice()

  return (
    <TableRow hover onClick={openInvoice(invoice)} sx={{ ...nestedRowSx(depth), ...clickableRowSx }}>
      <TableCell>
        <Box sx={indent(depth)}>
          <InvoiceLink invoice={invoice} />
          <Typography variant="caption" color="text.secondary" component="div" noWrap>
            {describeDaysPastDue(invoice.daysPastDue)}
          </Typography>
        </Box>
      </TableCell>
      <TableCell>
        <Typography variant="body2" color="text.secondary">
          Due {formatDate(invoice.dueDate)}
        </Typography>
      </TableCell>
      {AGING_BUCKETS.map(({ key }) => (
        <TableCell key={key} align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {invoice.bucket === key ? (
            <Typography component="span" fontWeight={750} sx={{ color: BUCKET_COLORS[key] }}>
              {formatCents(invoice.balanceCents)}
            </Typography>
          ) : null}
        </TableCell>
      ))}
      <TableCell align="right" sx={{ fontWeight: 850, fontVariantNumeric: 'tabular-nums' }}>
        {formatCents(invoice.balanceCents)}
      </TableCell>
    </TableRow>
  )
}

function GroupRows({ group, depth, expanded, onToggle, onDrill }) {
  const rowKey = `${group.level}:${group.key}`
  const open = expanded.has(rowKey)
  const name = group.level === 'job' ? group.jobName : group.builderName
  const label = group.level === 'job' ? `Job ${name}` : name
  const target = group.level === 'job'
    ? { builderId: group.builderId, jobId: group.jobId }
    : { builderId: group.builderId }

  let detail
  if (group.level === 'job') {
    detail = depth === 0 ? group.builderName : plural(group.invoiceCount, 'invoice')
  } else {
    const jobCount = new Set(group.invoices.map(({ jobId }) => jobId)).size
    detail = `${plural(jobCount, 'Job')} · ${plural(group.invoiceCount, 'invoice')}`
  }

  let children = null
  if (open && group.level === 'builder') {
    children = sortReceivableGroups(groupReceivables(group.invoices, 'job'), DEFAULT_GROUP_SORT)
      .map((job) => (
        <GroupRows
          key={`job:${job.key}`}
          group={job}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onDrill={onDrill}
        />
      ))
  } else if (open) {
    children = sortReceivableInvoices(group.invoices)
      .map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} depth={depth + 1} />)
  }

  return (
    <Fragment>
      <TableRow hover sx={nestedRowSx(depth)}>
        <TableCell>
          <ButtonBase
            onClick={() => onToggle(rowKey)}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              maxWidth: '100%',
              textAlign: 'left',
              borderRadius: 1,
              ...indent(depth),
              '&.Mui-focusVisible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main' },
            }}
          >
            {open
              ? <KeyboardArrowDownRoundedIcon fontSize="small" color="action" />
              : <KeyboardArrowRightRoundedIcon fontSize="small" color="action" />}
            <Typography fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>{name}</Typography>
          </ButtonBase>
        </TableCell>
        <TableCell>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {detail}
          </Typography>
        </TableCell>
        <BucketAmounts buckets={group.buckets} target={target} onDrill={onDrill} />
        <TableCell align="right" sx={{ fontWeight: 850, fontVariantNumeric: 'tabular-nums' }}>
          {formatCents(group.totalCents)}
        </TableCell>
      </TableRow>
      {children}
    </Fragment>
  )
}

/**
 * One row per Job or per Builder with what it owes in each bucket. A row opens to what
 * makes it up (a Builder's Jobs, a Job's Invoices), and an amount lists its invoices.
 */
export default function ReceivablesGroupTable({
  level,
  groups,
  sort,
  onSort,
  onDrill,
}) {
  const [expanded, setExpanded] = useState(() => new Set())
  const toggle = (rowKey) => setExpanded((current) => {
    const next = new Set(current)
    if (!next.delete(rowKey)) next.add(rowKey)
    return next
  })
  const header = { sort, onSort }
  const first = level === 'job' ? 'Job' : 'Builder'

  return (
    <TableContainer>
      <Table size="small" aria-label={`Open invoices by ${first}`} sx={{ ...tableSx, minWidth: MIN_WIDTH }}>
        <colgroup>
          {COLUMN_WIDTHS.map((width, index) => <col key={index} style={{ width }} />)}
        </colgroup>
        <TableHead>
          <TableRow sx={tableHeadRowSx}>
            <SortHeader column="name" label={first} {...header} />
            <TableCell>{level === 'job' ? 'Builder' : 'Open'}</TableCell>
            {AGING_BUCKETS.map(({ key, short }) => (
              <SortHeader key={key} column={key} label={short} align="right" firstDirection="desc" {...header} />
            ))}
            <SortHeader column="total" label="Total Due" align="right" firstDirection="desc" {...header} />
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((group) => (
            <GroupRows
              key={`${group.level}:${group.key}`}
              group={group}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              onDrill={onDrill}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
