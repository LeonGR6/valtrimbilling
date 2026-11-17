// Table styling shared by the Package tables: grey column heads, figures that
// line up, and no rule under the last row (the footer carries the total).
export const packageTableSx = {
  '& .MuiTableHead-root .MuiTableCell-head': {
    bgcolor: 'action.hover',
    color: 'text.secondary',
    fontWeight: 700,
  },
  '& .MuiTableCell-root': { fontVariantNumeric: 'tabular-nums' },
  '& .MuiTableFooter-root .MuiTableCell-root': {
    bgcolor: 'action.hover',
    borderBottom: 0,
    borderTop: 1,
    borderColor: 'divider',
  },
}
