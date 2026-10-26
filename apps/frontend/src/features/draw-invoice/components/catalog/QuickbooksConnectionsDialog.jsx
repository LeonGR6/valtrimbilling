import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import {
  pickQuickbooksConnection,
  quickbooksConnectionSummary,
} from '../../services/quickbooksRecord.js'

const ENVIRONMENTS = ['sandbox', 'production']
const CHIP_COLORS = { success: 'success', warning: 'warning', error: 'error', neutral: 'default' }

/**
 * Both QuickBooks connections side by side: which company each one is linked to,
 * whether it is the mode new invoices go to, and how long its authorization lasts.
 * Only an administrator can connect or reconnect.
 */
export default function QuickbooksConnectionsDialog({
  connections,
  activeEnvironment,
  canConnect,
  onConnect,
  onClose,
}) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>QuickBooks connections</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Test and Production are two separate QuickBooks companies, each with its own
            connection. The mode switch decides which one new invoices go to.
          </Typography>
          {ENVIRONMENTS.map((environment) => {
            const summary = quickbooksConnectionSummary(
              environment,
              pickQuickbooksConnection(connections, environment),
            )
            const connected = summary.status !== 'Not connected'
            return (
              <Box
                key={environment}
                sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Typography fontWeight={800}>{summary.label}</Typography>
                  {environment === activeEnvironment && (
                    <Chip
                      size="small"
                      color={environment === 'production' ? 'error' : 'warning'}
                      label="Active mode"
                      sx={{ fontWeight: 700 }}
                    />
                  )}
                  <Chip
                    size="small"
                    variant="outlined"
                    color={CHIP_COLORS[summary.tone]}
                    label={summary.status}
                  />
                  <Box sx={{ flex: 1 }} />
                  {canConnect && (
                    <Button size="small" onClick={() => onConnect(environment)}>
                      {connected ? 'Reconnect' : 'Connect'}
                    </Button>
                  )}
                </Stack>
                {connected && (
                  <Stack spacing={0.25} sx={{ mt: 1 }}>
                    <Typography variant="body2">{summary.company}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {summary.product ? `Product: ${summary.product}` : 'Product not found'}
                    </Typography>
                    {summary.expiry && (
                      <Typography
                        variant="body2"
                        color={summary.attention ? `${summary.tone}.main` : 'text.secondary'}
                      >
                        {summary.expiry}
                      </Typography>
                    )}
                  </Stack>
                )}
              </Box>
            )
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
