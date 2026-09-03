import {
  Box,
  Button,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'

export default function CalendarPageHeader({
  activeTab,
  calendarMode,
  onChangeTab,
  onChangeMode,
  onCreate,
}) {
  return (
    <>
      <Box className="calendar-page__header">
        <Box>
          <Typography variant="h4" fontWeight={780} letterSpacing="-0.025em">Calendar</Typography>
          <Typography color="text.secondary">
            {activeTab === 'BUILDER_SETTINGS'
              ? 'Configure the automatic EXT, Shutter, DM and HW date spacing for each builder.'
              : calendarMode === 'PRODUCTION'
                ? 'Schedule EXT, optional Shutter, DM and HW as one production activity.'
                : 'Track extra work and change orders separately.'}
          </Typography>
        </Box>

        {activeTab === 'SCHEDULE' && (
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
        )}
      </Box>

      <Box className="calendar-primary-tabs">
        <Tabs
          value={activeTab}
          onChange={onChangeTab}
          aria-label="Calendar tabs"
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab
            value="SCHEDULE"
            icon={<CalendarMonthRoundedIcon />}
            iconPosition="start"
            label="Calendar"
          />
          <Tab
            value="BUILDER_SETTINGS"
            icon={<TuneRoundedIcon />}
            iconPosition="start"
            label="Builder date configuration"
          />
        </Tabs>
      </Box>
    </>
  )
}
