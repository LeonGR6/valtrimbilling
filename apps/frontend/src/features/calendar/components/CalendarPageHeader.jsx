import {
  Box,
  Button,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ConstructionRoundedIcon from '@mui/icons-material/ConstructionRounded'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import SyncAltRoundedIcon from '@mui/icons-material/SyncAltRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'

export default function CalendarPageHeader({
  activeTab,
  calendarMode,
  onChangeTab,
  onChangeMode,
  onConnectGoogleCalendar,
  onSyncGoogleCalendar,
  onCreate,
  canConnectGoogleCalendar = false,
  canCreate = true,
  googleCalendarConnected = false,
  googleCalendarLoading = false,
  googleCalendarSyncing = false,
}) {
  const googleButtonLabel = googleCalendarLoading
    ? 'Checking Google…'
    : googleCalendarConnected
      ? 'Google connected'
      : 'Connect Google Calendar'
  const googleButtonTitle = !canConnectGoogleCalendar
    ? 'Only an administrator can connect Google Calendar.'
    : googleCalendarConnected
      ? 'The dedicated Google calendar is connected. Select to reconnect.'
      : 'Connect a dedicated calendar owned by your Google account.'

  return (
    <>
      <Box className="calendar-page__header">
        <Box>
          <Typography variant="h4" fontWeight={780} letterSpacing="-0.025em">Calendar</Typography>
          <Typography color="text.secondary">
            {activeTab === 'BUILDER_SETTINGS'
              ? 'Configure the automatic EXT, Shutter, DM and HW date spacing for each builder.'
              : calendarMode === 'PRODUCTION'
                ? 'Schedule EXT, DM and HW as one production activity.'
                : 'Track extra work and change orders separately.'}
          </Typography>
        </Box>

        {activeTab === 'SCHEDULE' && (
          <Box className="calendar-page__actions">
            <Box className="calendar-mode-tabs">
              <Tabs
                value={calendarMode}
                onChange={onChangeMode}
                aria-label="Calendar section"
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab
                  value="PRODUCTION"
                  icon={<ConstructionRoundedIcon />}
                  iconPosition="start"
                  label="Production"
                />
                <Tab
                  value="CHANGE_ORDERS"
                  icon={<SyncAltRoundedIcon />}
                  iconPosition="start"
                  label="Extra / Change Orders"
                />
              </Tabs>
            </Box>
            <Tooltip title={googleButtonTitle}>
              <span>
                <Button
                  variant={googleCalendarConnected ? 'outlined' : 'contained'}
                  color={googleCalendarConnected ? 'success' : 'primary'}
                  startIcon={googleCalendarConnected
                    ? <CheckCircleRoundedIcon />
                    : <EventAvailableRoundedIcon />}
                  onClick={onConnectGoogleCalendar}
                  disabled={
                    !canConnectGoogleCalendar
                    || googleCalendarLoading
                    || googleCalendarSyncing
                  }
                >
                  {googleButtonLabel}
                </Button>
              </span>
            </Tooltip>
            {googleCalendarConnected && (
              <Tooltip title="Copy the current ValtrimBilling Production calendar to Google Calendar.">
                <span>
                  <Button
                    variant="contained"
                    startIcon={<SyncRoundedIcon />}
                    onClick={onSyncGoogleCalendar}
                    disabled={!canConnectGoogleCalendar || googleCalendarSyncing}
                  >
                    {googleCalendarSyncing ? 'Syncing…' : 'Sync now'}
                  </Button>
                </span>
              </Tooltip>
            )}
            {calendarMode === 'PRODUCTION' ? (
              <Tooltip title={canCreate ? '' : 'Your role has read-only access to Production activities.'}>
                <span>
                  <ResponsiveCreateButton label="New activity" onClick={onCreate} disabled={!canCreate} />
                </span>
              </Tooltip>
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
