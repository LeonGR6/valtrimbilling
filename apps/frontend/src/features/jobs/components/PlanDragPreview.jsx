import { Chip, Paper, Typography } from '@mui/material'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'

// What follows the pointer while a Plan is dragged.
export default function PlanDragPreview({ plan }) {
  const count = plan.options?.length ?? 0

  return (
    <Paper
      elevation={6}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 1,
        width: 'min(340px, 90vw)',
        bgcolor: 'primary.light',
        border: 1,
        borderColor: 'primary.main',
        cursor: 'grabbing',
      }}
    >
      <DragIndicatorRoundedIcon fontSize="small" color="action" />
      <Typography variant="body2" fontWeight={800}>Plan {plan.code}</Typography>
      <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
        {plan.name || `Plan ${plan.code}`}
      </Typography>
      <Chip
        size="small"
        color="primary"
        variant="outlined"
        label={count}
        sx={{ minWidth: 34, fontWeight: 700 }}
      />
    </Paper>
  )
}
