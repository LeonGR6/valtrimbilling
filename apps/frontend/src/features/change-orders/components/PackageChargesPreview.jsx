import { useMemo } from 'react'
import {
  Alert,
  Box,
  Card,
  CardContent,
  Checkbox,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { formatPhaseBuilding } from '../../sequence-sheets/utils/phaseBuildingCodes.js'
import { groupPackageCharges } from '../utils/packageCharges.js'

const money = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`

/**
 * Under the Package preview: the Lots it bills that a Plan with an approved "Specific Plan Types" Extra / CO
 * charges, one row per Lot with the Scope and Amount of its Plan, each with a box. The ones ticked are
 * charged: creating the Package makes an Extra / CO of its own for them, listed in the Change Orders tab (the
 * Package's totals do not change). All are ticked to start with; any can be unticked.
 * `rows` are the Lots (`toPackageChargeRow`), `chosen` the ids of the ones ticked. Nothing is shown without rows.
 */
export default function PackageChargesPreview({ rows, error = '', chosen, onChange }) {
  const { groups } = useMemo(() => groupPackageCharges(rows), [rows])
  const chosenRows = rows.filter((row) => chosen.has(row.lotId))
  const chosenCents = chosenRows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0)

  if (error) {
    return <Alert severity="warning">{error}</Alert>
  }
  if (rows.length === 0) return null

  const toggle = (ids, on) => {
    const next = new Set(chosen)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    onChange(next)
  }
  return (
    <Card variant="outlined" component="section" aria-label="Extras / Change Orders to charge" sx={{ bgcolor: 'action.hover' }}>
      <CardContent sx={{ p: '16px !important' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'baseline' }, justifyContent: 'space-between' }}
        >
          <Typography fontWeight={800}>Extras / Change Orders</Typography>
          <Typography variant="body2">
            {chosenRows.length} of {plural(rows.length, 'lot')} charged ·{' '}
            <Box component="strong" sx={money}>{formatCurrency(chosenCents / 100)}</Box>
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 760 }}>
          These Lots have a Plan with an approved Extra / CO. The ones ticked are charged with this Package: it makes
          an Extra / CO of its own for them, listed in the Change Orders tab, and its totals do not change.
        </Typography>

        <Stack spacing={2} sx={{ mt: 1.5 }}>
          {groups.map((group) => {
            const ids = group.rows.map((row) => row.lotId)
            const count = ids.filter((id) => chosen.has(id)).length
            return (
              <Box key={group.sourceId}>
                <Typography variant="body2" fontWeight={800}>
                  From {group.number}
                  {group.poCoNumber ? ` · PO / CO # ${group.poCoNumber}` : ''}
                </Typography>
                <Box
                  sx={{
                    mt: 0.75,
                    overflowX: 'auto',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    bgcolor: 'background.paper',
                  }}
                >
                  <Table size="small" aria-label={`Lots that ${group.number} could charge`} sx={{ minWidth: 560 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox" sx={{ width: 48 }}>
                          <Checkbox
                            size="small"
                            checked={count === ids.length}
                            indeterminate={count > 0 && count < ids.length}
                            onChange={(event) => toggle(ids, event.target.checked)}
                            slotProps={{ input: { 'aria-label': `Every Lot of ${group.number}` } }}
                          />
                        </TableCell>
                        <TableCell sx={{ width: 180 }}>Lot</TableCell>
                        <TableCell sx={{ width: 110 }}>Plan</TableCell>
                                                <TableCell>Scope of Work</TableCell>
                        <TableCell align="right" sx={{ width: 110 }}>Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.rows.map((row) => (
                        <TableRow key={row.lotId} hover selected={chosen.has(row.lotId)}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              size="small"
                              checked={chosen.has(row.lotId)}
                              onChange={(event) => toggle([row.lotId], event.target.checked)}
                              slotProps={{
                                input: { 'aria-label': `Charge Lot ${row.lot}, ${formatPhaseBuilding(row.phase, row.building)}` },
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={700}>Lot {row.lot}</Typography>
                            <Typography variant="caption" color="text.secondary" component="div">
                              {formatPhaseBuilding(row.phase, row.building)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">Plan {row.plan}</Typography>
                            {row.planName && (
                              <Typography variant="caption" color="text.secondary" component="div">
                                {row.planName}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.scope}</TableCell>
                          <TableCell align="right" sx={money}>{formatCurrency(row.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            )
          })}
        </Stack>
      </CardContent>
    </Card>
  )
}
