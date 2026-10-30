import { IconButton } from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'

// Chevron that opens or closes the options of a Plan.
export default function PlanToggle({ plan, expanded, onToggle, controls }) {
  return (
    <IconButton
      size="small"
      aria-label={`${expanded ? 'Collapse' : 'Expand'} Plan ${plan.code}`}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      sx={{ color: 'text.secondary' }}
    >
      <ExpandMoreRoundedIcon
        fontSize="small"
        sx={{
          transition: 'transform 150ms',
          transform: expanded ? 'none' : 'rotate(-90deg)',
        }}
      />
    </IconButton>
  )
}
