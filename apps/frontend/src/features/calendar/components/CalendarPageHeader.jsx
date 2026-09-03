import {
  Box,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'

export default function CalendarPageHeader({ calendarMode, onChangeMode, onCreate }) {
  return (
    <Box className="calendar-page__header">
      <Box>
        <Typography variant="h4" fontWeight={780} letterSpacing="-0.025em">Calendar</Typography>
        <Typography color="text.secondary">
          {calendarMode === 'PRODUCTION'
            ? 'Schedule EXT, DM and HW as one production activity.'
            : 'Track extra work and change orders separately.'}
        </Typography>
      </Box>

      <Box className="calendar-page__actions">
        <ToggleButtonGroup
          exclusive
          value={calendarMode}
          onChange={onChangeMode}
          size="small"
          aria-label="Calendar section"
          className="calendar-mode-toggle"
        >
          <ToggleButton value="PRODUCTION">Production</ToggleButton>
          <ToggleButton value="CHANGE_ORDERS">Extra / Change Orders</ToggleButton>
        </ToggleButtonGroup>
        {calendarMode === 'PRODUCTION' ? (
          <ResponsiveCreateButton label="New activity" onClick={onCreate} />
        ) : (
          <Tooltip title="Extra / Change Orders is pending">
            <span><Button variant="contained" disabled>New change order</Button></span>
          </Tooltip>
        )}
      </Box>
    </Box>
  )
}
