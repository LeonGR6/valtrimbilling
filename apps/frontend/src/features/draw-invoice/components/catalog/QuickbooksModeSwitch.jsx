import { Chip, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material'
import { quickbooksEnvironmentLabel } from '../../services/quickbooksRecord.js'

const MODES = ['sandbox', 'production']

// Test is amber and Production is red on purpose: sending to the wrong one is
// the costly mistake, so the active mode is never subtle.
const SELECTED_STYLES = {
  sandbox: { bgcolor: 'warning.main', color: 'warning.contrastText' },
  production: { bgcolor: 'error.main', color: 'error.contrastText' },
}

function title(environment, { connected, canSwitch, active }) {
  const label = quickbooksEnvironmentLabel(environment)
  if (!canSwitch) return 'Only an administrator can change the QuickBooks mode.'
  if (active) {
    return environment === 'production'
      ? 'New invoices go to your real QuickBooks.'
      : 'New invoices go to the QuickBooks Test company. Nothing reaches your real books.'
  }
  return connected
    ? `Send new invoices to QuickBooks ${label}.`
    : `QuickBooks ${label} is not connected yet. Select to connect it.`
}

/**
 * Where new invoices go: QuickBooks Test (sandbox) or Production. Only an
 * administrator can change it; everyone else sees which one is active. An
 * environment that is not connected is connected when selected.
 */
export default function QuickbooksModeSwitch({
  activeEnvironment,
  connections,
  canSwitch,
  switching,
  loading,
  onSwitch,
}) {
  const isConnected = (environment) => connections.some(
    (connection) => connection.environment === environment && connection.status === 'CONNECTED',
  )

  if (!canSwitch) {
    return (
      <Tooltip title={title(activeEnvironment, { connected: true, canSwitch, active: true })}>
        <Chip
          size="small"
          color={activeEnvironment === 'production' ? 'error' : 'warning'}
          label={`${quickbooksEnvironmentLabel(activeEnvironment)} mode`}
          sx={{ fontWeight: 800 }}
        />
      </Tooltip>
    )
  }

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={activeEnvironment}
      disabled={switching || loading}
      aria-label="QuickBooks mode"
      onChange={(_event, value) => {
        if (value) onSwitch(value)
        // Selecting the active mode again does nothing; a not connected one connects.
        else if (!isConnected(activeEnvironment)) onSwitch(activeEnvironment)
      }}
    >
      {MODES.map((environment) => {
        const active = environment === activeEnvironment
        const connected = isConnected(environment)
        return (
          <Tooltip key={environment} title={title(environment, { connected, canSwitch, active })}>
            <span>
              <ToggleButton
                value={environment}
                aria-label={`QuickBooks ${quickbooksEnvironmentLabel(environment)}`}
                sx={{
                  px: 1.25,
                  py: 0.4,
                  fontWeight: 800,
                  textTransform: 'none',
                  '&.Mui-selected, &.Mui-selected:hover': SELECTED_STYLES[environment],
                }}
              >
                {quickbooksEnvironmentLabel(environment)}
                {!connected && ' · connect'}
              </ToggleButton>
            </span>
          </Tooltip>
        )
      })}
    </ToggleButtonGroup>
  )
}
