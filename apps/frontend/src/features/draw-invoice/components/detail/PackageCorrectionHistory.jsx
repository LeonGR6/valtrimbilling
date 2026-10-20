import { Box, Card, Chip, Typography } from '@mui/material'
import { TableCardHeader } from '../shared/PackageUi.jsx'

const ACTION_LABELS = {
  EDIT: 'Edited',
  CANCEL: 'Cancelled',
  RECALCULATE: 'Prices updated',
}

function describeCorrection(correction, packageId) {
  const movedHere = String(correction.package_id) === String(packageId)
  if (correction.action === 'TRANSFER') {
    return {
      label: movedHere ? 'Cells moved here' : 'Cells moved out',
      color: 'info',
      other: movedHere ? correction.other_package_id : correction.package_id,
    }
  }
  const lower = correction.action.toLowerCase()
  return {
    label: ACTION_LABELS[correction.action] ?? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`,
    color: correction.action === 'CANCEL' ? 'default' : 'primary',
    other: null,
  }
}

/**
 * Every correction made to the Package, newest first: when, what, and the
 * reason that was given.
 */
export default function PackageCorrectionHistory({ package: record }) {
  const corrections = [...(record.corrections ?? [])].sort(
    (a, b) => new Date(b.changed_at) - new Date(a.changed_at),
  )

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <TableCardHeader
        title="Correction history"
        description="Changes made after the Package was created."
        chip={<Chip size="small" variant="outlined" label={corrections.length} />}
      />
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {corrections.map((correction) => {
          const { label, color, other } = describeCorrection(correction, record.id)
          return (
            <Box
              component="li"
              key={correction.id}
              sx={{
                px: { xs: 2, sm: 2.5 },
                py: 1.25,
                display: 'grid',
                gap: { xs: 0.5, sm: 2 },
                gridTemplateColumns: { xs: '1fr', sm: '170px 150px minmax(0, 1fr)' },
                alignItems: 'baseline',
                '& + &': { borderTop: 1, borderColor: 'divider' },
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {new Date(correction.changed_at).toLocaleString('en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </Typography>
              <Box>
                <Chip size="small" color={color} variant="outlined" label={label} />
              </Box>
              <Typography variant="body2">
                {correction.reason}
                {other != null && (
                  <Typography component="span" variant="body2" color="text.secondary">
                    {` · Other Package ID ${other}`}
                  </Typography>
                )}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Card>
  )
}
