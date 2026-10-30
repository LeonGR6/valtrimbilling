/** Keyboard focus ring for text-like buttons and links that live inside tables. */
export const focusRingSx = {
  '&:focus-visible': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: 2,
    borderRadius: 0.5,
  },
}

/** Table styling shared with the Packages catalog: grey sentence-case heads, aligned figures. */
export const catalogTableSx = {
  '& .MuiTableHead-root .MuiTableCell-head': {
    bgcolor: 'action.hover',
    color: 'text.secondary',
    fontWeight: 700,
    fontSize: 13,
    py: 1,
    whiteSpace: 'nowrap',
  },
  '& .MuiTableBody-root .MuiTableCell-root': { py: 1.25 },
  '& .MuiTableCell-root': { fontVariantNumeric: 'tabular-nums' },
  '& tbody tr:last-of-type .MuiTableCell-root': { borderBottom: 0 },
}

/** Text for screen readers only (a column head that has no visible label). */
export const visuallyHiddenSx = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
}
