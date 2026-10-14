import {
  Badge,
  Box,
  Button,
  IconButton,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded'
import ForwardToInboxRoundedIcon from '@mui/icons-material/ForwardToInboxRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { googleCalendarLastSyncLabel } from '../services/googleCalendarRecord.js'

// Google's "G" mark, so it is clear where the calendar connects to Google.
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  )
}

export default function CalendarPageHeader({
  activeTab,
  calendarMode,
  onChangeTab,
  onConnectGoogleCalendar,
  onSyncGoogleCalendar,
  onCreate,
  unscheduledCount = 0,
  canConnectGoogleCalendar = false,
  canCreate = true,
  googleCalendarConnected = false,
  googleCalendarLastSyncAt = null,
  googleCalendarLoading = false,
  googleCalendarSyncing = false,
}) {
  const googleStatusTitle = googleCalendarLoading
    ? 'Checking Google…'
    : !canConnectGoogleCalendar
      ? 'Only an administrator can connect Google Calendar.'
      : googleCalendarConnected
        ? `Google connected · ${googleCalendarLastSyncLabel(googleCalendarLastSyncAt)}. Select to reconnect.`
        : 'Connect a dedicated calendar owned by your Google account.'
  const googleConnectDisabled = !canConnectGoogleCalendar
    || googleCalendarLoading
    || googleCalendarSyncing
  const subtitle = activeTab === 'BUILDER_SETTINGS'
    ? 'Configure the automatic EXT, Shutter, DM and HW date spacing for each builder.'
    : activeTab === 'FOLLOW_UPS'
      ? 'Prepare and track scheduling emails to each Jobsite Superintendent.'
      : activeTab === 'UNSCHEDULED'
        ? 'Phases created in Sequence Sheets that have no EXT, DM or HW events yet.'
        : calendarMode === 'PRODUCTION'
          ? 'Schedule EXT, DM and HW as one production activity.'
          : 'Track extra work and change orders separately.'

  return (
    <>
      <Box className="calendar-page__header">
        <Box className="calendar-page__title">
          <Typography variant="h6" component="h1" fontWeight={780} letterSpacing="-0.02em">
            Calendar
          </Typography>
          <Typography variant="caption" color="text.secondary" className="calendar-page__subtitle">
            {subtitle}
          </Typography>
        </Box>

        {activeTab === 'SCHEDULE' && (
          <Box className="calendar-page__actions">
            <Tooltip title={googleStatusTitle}>
              <span>
                <IconButton
                  size="small"
                  className="google-connect-button"
                  onClick={onConnectGoogleCalendar}
                  disabled={googleConnectDisabled}
                  aria-label={googleCalendarConnected
                    ? 'Google Calendar connected. Reconnect'
                    : 'Connect Google Calendar'}
                >
                  <Badge
                    overlap="circular"
                    variant="dot"
                    invisible={!googleCalendarConnected}
                    className="google-connect-button__badge"
                  >
                    <GoogleLogo />
                  </Badge>
                </IconButton>
              </span>
            </Tooltip>
            {googleCalendarConnected && (
              <Tooltip title="Copy the current ValtrimBilling Production calendar to Google Calendar.">
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    color="inherit"
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
                  <ResponsiveCreateButton
                    size="small"
                    label="New activity"
                    onClick={onCreate}
                    disabled={!canCreate}
                  />
                </span>
              </Tooltip>
            ) : (
              <Tooltip title="Extra / Change Orders is pending">
                <span><Button size="small" variant="contained" disabled>New change order</Button></span>
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
          <Tab
            value="FOLLOW_UPS"
            icon={<ForwardToInboxRoundedIcon />}
            iconPosition="start"
            label="Builder follow-ups"
          />
          <Tab
            value="UNSCHEDULED"
            icon={<EventBusyRoundedIcon />}
            iconPosition="start"
            label={unscheduledCount > 0
              ? `Unscheduled phases (${unscheduledCount})`
              : 'Unscheduled phases'}
          />
        </Tabs>
      </Box>
    </>
  )
}
