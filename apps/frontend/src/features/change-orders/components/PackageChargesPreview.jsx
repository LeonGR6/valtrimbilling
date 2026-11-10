import { useMemo } from 'react'
import {
  Alert,
  Box,
  Card,
  CardContent,
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
import { usePackageCharges } from '../hooks/useChangeOrderData.js'
import { groupPackageCharges } from '../utils/packageCharges.js'

const money = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`

/**
 * Under the Package preview: the Lots it bills that an approved "Specific Plan Types" Extra / CO charges,
 * one row per Lot with the Scope and Amount of its Plan. They are not part of the Package (its totals do
 * not change): creating it makes an Extra / CO of its own for them, listed in the Change Orders tab. Nothing is
 * shown when no Lot is charged.
 * `jobId` is the Job, `lotIds` the Lots the Packages about to be created bill (`packageLotIds`).
 */
export default function PackageChargesPreview({ jobId, lotIds }) {
  const { rows, error } = usePackageCharges(jobId, lotIds)
  const { groups, lots, total } = useMemo(() => groupPackageCharges(rows), [rows])

  if (error) {
    return <Alert severity="warning">{error} The Package can still be created; the database charges them anyway.</Alert>
  }
  if (lots === 0) return null

  return (
    <Card variant="outlined" component="section" aria-label="Extras / Change Orders charged" sx={{ bgcolor: 'action.hover' }}>
      <CardContent sx={{ p: '16px !important' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'baseline' }, justifyContent: 'space-between' }}
        >
          <Typography fontWeight={800}>Extras / Change Orders</Typography>
          <Typography variant="body2">
            {plural(lots, 'lot')} · <Box component="strong" sx={money}>{formatCurrency(total)}</Box>
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 760 }}>
          These Lots have a Plan with an approved Extra / CO. They are not charged on this Package and its totals
          do not change: creating it makes an Extra / CO of its own for them, listed in the Change Orders tab.
        </Typography>

        <Stack spacing={2} sx={{ mt: 1.5 }}>
          {groups.map((group) => (
            <Box key={group.sourceId}>
              <Typography variant="body2" fontWeight={800}>
                From {group.number}
                {group.poCoNumber ? ` · PO / CO # ${group.poCoNumber}` : ''}
              </Typography>
              {/* On a phone each Lot is a block with its Amount in view; from sm, a table. */}
              <Box
                component="ul"
                aria-label={`Lots charged from ${group.number}`}
                sx={{
                  display: { xs: 'block', sm: 'none' },
                  m: 0,
                  mt: 0.75,
                  p: 0,
                  listStyle: 'none',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  bgcolor: 'background.paper',
                }}
              >
                {group.rows.map((row, index) => (
                  <Box
                    component="li"
                    key={row.lotId}
                    sx={{ px: 1.5, py: 1, borderTop: index === 0 ? 0 : 1, borderColor: 'divider' }}
                  >
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" fontWeight={700}>
                        Lot {row.lot} · Plan {row.plan}
                      </Typography>
                      <Typography variant="body2" fontWeight={700} sx={money}>{formatCurrency(row.amount)}</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {formatPhaseBuilding(row.phase, row.building)}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>{row.scope}</Typography>
                  </Box>
                ))}
              </Box>
              <Box
                sx={{
                  display: { xs: 'none', sm: 'block' },
                  mt: 0.75,
                  overflowX: 'auto',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  bgcolor: 'background.paper',
                }}
              >
                <Table size="small" aria-label={`Lots charged from ${group.number}`} sx={{ minWidth: 560 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 200 }}>Lot</TableCell>
                      <TableCell sx={{ width: 110 }}>Plan</TableCell>
                      <TableCell>Scope of Work</TableCell>
                      <TableCell align="right" sx={{ width: 120 }}>Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {group.rows.map((row) => (
                      <TableRow key={row.lotId}>
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
                    {groups.length > 1 && (
                      <TableRow>
                        <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Total from {group.number}</TableCell>
                        <TableCell align="right" sx={{ ...money, fontWeight: 700 }}>{formatCurrency(group.total)}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}
