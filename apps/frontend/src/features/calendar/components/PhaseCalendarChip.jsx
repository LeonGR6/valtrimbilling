import { Chip, Tooltip } from '@mui/material'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded'

/** Shows whether a Phase has Production events (EXT, DM and HW) in the Calendar. */
export default function PhaseCalendarChip({ status, size = 'small' }) {
  if (status === 'unscheduled') {
    return (
      <Tooltip title="No EXT, DM or HW events are scheduled for this Phase yet. Without them it will not get Package Suggestions.">
        <Chip
          size={size}
          color="warning"
          icon={<EventBusyRoundedIcon />}
          label="No Calendar events"
        />
      </Tooltip>
    )
  }

  if (status === 'scheduled') {
    return (
      <Chip
        size={size}
        color="success"
        variant="outlined"
        icon={<EventAvailableRoundedIcon />}
        label="On Calendar"
      />
    )
  }

  return null
}
