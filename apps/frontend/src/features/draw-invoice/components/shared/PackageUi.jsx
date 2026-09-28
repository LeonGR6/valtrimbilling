import {
  Box,
  Card,
  CardContent,
  Chip,
  MenuItem,
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

export function MetricCard({ icon, label, value, detail }) {
  return (
    <Card variant="outlined" sx={{ minWidth: 190, flex: 1 }}>
      <CardContent sx={{ display: 'flex', gap: 1.5, p: '16px !important' }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'primary.light',
            color: 'primary.main',
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.2 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {label}
          </Typography>
          {detail && (
            <Typography variant="caption" color="text.secondary" component="div">
              {detail}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  )
}
