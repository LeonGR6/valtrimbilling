import {
  Box,
  Card,
  Chip,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  DRAW_PACKAGE_STATUSES,
  DRAW_PACKAGE_STATUS_LABELS,
} from '../../services/drawInvoicePackageRecord.js'
import { readinessLabel } from '../../utils/drawInvoiceFormatters.js'

export function ReadinessChip({ worksheet }) {
  return (
    <Chip
      size="small"
      color={worksheet.isReady ? 'success' : 'warning'}
      variant={worksheet.isReady ? 'filled' : 'outlined'}
      icon={
        worksheet.isReady ? (
          <CheckCircleRoundedIcon />
        ) : (
          <WarningAmberRoundedIcon />
        )
      }
      label={readinessLabel(worksheet)}
      sx={{ fontWeight: 750 }}
    />
  )
}

export function PackageStatusChip({ status }) {
  const color =
    status === 'CANCELLED'
      ? 'default'
      : status === 'PAID_CLOSED'
        ? 'success'
        : status === 'AWAITING_PAYMENT'
          ? 'info'
          : status === 'DRAFT'
            ? 'warning'
            : 'primary'

  return (
    <Chip
      size="small"
      color={color}
      variant={status === 'DRAFT' ? 'outlined' : 'filled'}
      label={DRAW_PACKAGE_STATUS_LABELS[status] ?? status}
      sx={{ fontWeight: 750 }}
    />
  )
}

export function PackageStatusControl({ status, disabled, onChange }) {
  return (
    <TextField
      select
      size="small"
      label="Package status"
      value={status}
      onChange={onChange}
      disabled={disabled}
      sx={{ minWidth: 190 }}
    >
      {DRAW_PACKAGE_STATUSES.map((packageStatus) => (
        <MenuItem key={packageStatus} value={packageStatus}>
          {DRAW_PACKAGE_STATUS_LABELS[packageStatus]}
        </MenuItem>
      ))}
    </TextField>
  )
}

/**
 * The Package's invoice at a glance, laid out like the invoice itself: what the
 * Package covers on the left, the amounts as a ledger on the right (each amount
 * joined to its label by a dotted leader), with the Invoice Amount as the
 * closing line.
 *
 * facts: [{ label, value, detail, chips }] - what is in the Package.
 * lines: [{ label, value, tone }]          - amounts above the total; tone
 *                                            'deduction' is red, 'muted' is a zero.
 * total: { label, value, detail }          - the closing line.
 * note: optional muted line under the ledger (what the total includes).
 */
export function PackageSummaryPanel({ facts, lines, total, note }) {
  return (
    <Card variant="outlined">
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(340px, 440px)' },
        }}
      >
        <Box
          component="dl"
          sx={{
            m: 0,
            p: { xs: 2, md: 2.5 },
            display: 'flex',
            flexWrap: 'wrap',
            alignContent: 'flex-start',
            columnGap: { xs: 4, md: 6 },
            rowGap: 2,
          }}
        >
          {facts.map(({ label, value, detail, chips }) => (
            <Box key={label} sx={{ minWidth: 0 }}>
              <Typography component="dt" variant="body2" sx={{ color: 'text.secondary' }}>
                {label}
              </Typography>
              <Typography
                component="dd"
                variant="h4"
                sx={{ m: 0, fontWeight: 800, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}
              >
                {value}
              </Typography>
              {detail && (
                <Typography component="dd" variant="caption" sx={{ m: 0, display: 'block', color: 'text.secondary' }}>
                  {detail}
                </Typography>
              )}
              {chips?.length > 0 && (
                <Stack
                  component="dd"
                  direction="row"
                  spacing={0.5}
                  useFlexGap
                  sx={{ m: 0, mt: 0.75, flexWrap: 'wrap' }}
                >
                  {chips.map((chip) => (
                    <Chip key={chip} size="small" variant="outlined" label={chip} />
                  ))}
                </Stack>
              )}
            </Box>
          ))}
        </Box>

        <Box
          sx={{
            p: { xs: 2, md: 2.5 },
            borderTop: { xs: '1px solid', md: 0 },
            borderLeft: { md: '1px solid' },
            borderTopColor: 'divider',
            borderLeftColor: 'divider',
            bgcolor: 'action.hover',
          }}
        >
          <Stack spacing={1} sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {lines.map(({ label, value, tone }) => (
              <Stack key={label} direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
                <Box
                  aria-hidden
                  sx={{ flex: 1, minWidth: 16, borderBottom: '1px dotted', borderBottomColor: 'divider' }}
                />
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700,
                    color: tone === 'deduction'
                      ? 'error.main'
                      : tone === 'muted'
                        ? 'text.disabled'
                        : 'text.primary',
                  }}
                >
                  {value}
                </Typography>
              </Stack>
            ))}
          </Stack>
          <Stack
            direction="row"
            sx={{
              mt: lines.length > 0 ? 1.5 : 0,
              pt: lines.length > 0 ? 1.5 : 0,
              borderTop: lines.length > 0 ? '2px solid' : 0,
              borderTopColor: 'divider',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 2,
            }}
          >
            <Typography sx={{ fontWeight: 800 }}>{total.label}</Typography>
            <Typography
              variant="h4"
              sx={{ fontWeight: 850, color: 'success.main', fontVariantNumeric: 'tabular-nums' }}
            >
              {total.value}
            </Typography>
          </Stack>
          {total.detail && (
            <Typography variant="caption" sx={{ display: 'block', textAlign: 'right', color: 'text.secondary' }}>
              {total.detail}
            </Typography>
          )}
          {note && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
              {note}
            </Typography>
          )}
        </Box>
      </Box>
    </Card>
  )
}

/**
 * The header of a table card: a title with an optional count or total chip, and
 * one line saying what the table holds. The column heads carry the grey band.
 */
export function TableCardHeader({ title, description, chip, children }) {
  return (
    <>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{
          px: { xs: 2, sm: 2.5 },
          py: 1.5,
          justifyContent: 'space-between',
          alignItems: { sm: 'center' },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="div" fontWeight={800}>{title}</Typography>
          {description && (
            <Typography component="div" variant="body2" color="text.secondary">{description}</Typography>
          )}
          {children}
        </Box>
        {chip}
      </Stack>
      <Divider />
    </>
  )
}
