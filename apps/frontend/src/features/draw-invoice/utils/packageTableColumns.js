// The columns of the Packages table. The placeholder shown while it loads uses the same
// widths and labels, so the page does not shift when the rows arrive.
export const PACKAGE_TABLE_COLUMNS = [
  { key: 'package', label: 'Package', width: 240 },
  { key: 'status', label: 'Status', width: 140 },
  { key: 'quickbooks', label: 'QuickBooks', width: 150 },
  { key: 'builder', label: 'Builder/Community', width: 170 },
  { key: 'billing-period', label: 'Billing Period', width: 130 },
  { key: 'lots', label: 'Lots/Scopes', width: 105 },
  { key: 'current-draw', label: 'Current Draw', width: 135 },
  { key: 'retention-wrap', label: 'Retention / WRAP Insurance', width: 180 },
  { key: 'invoice-amount', label: 'Invoice Amount', width: 140 },
  { key: 'documents', label: 'Documents', width: 125 },
  { key: 'action', label: 'Action', width: 120 },
]

export const PACKAGE_TABLE_MIN_WIDTH = PACKAGE_TABLE_COLUMNS.reduce(
  (total, column) => total + column.width,
  0,
)
