import { Box, Stack, Typography } from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import { useFormContext, useWatch } from 'react-hook-form'
import { setupFromFormValues } from '../../utils/setupForm.js'
import { diffSetups } from '../../utils/setupSummary.js'
import BillingSetupSummary from '../BillingSetupSummary.jsx'

function Status({ issues, blockedByNoChange }) {
  const ready = issues.length === 0 && !blockedByNoChange
  const Icon = ready ? CheckCircleRoundedIcon : ErrorOutlineRoundedIcon
  const color = ready ? 'success.main' : issues.length > 0 ? 'error.main' : 'text.secondary'

  return (
    <Box sx={{ border: 1, borderColor: ready ? 'success.main' : 'divider', borderRadius: 2, px: 1.75, py: 1.25 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Icon fontSize="small" sx={{ color }} />
        <Typography fontWeight={800} aria-live="polite">
          {ready
            ? 'Ready to save'
            : issues.length > 0
              ? `${issues.length} ${issues.length === 1 ? 'thing' : 'things'} to fix`
              : 'Nothing has changed yet'}
        </Typography>
      </Stack>
      {issues.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.5 }}>
          {issues.map((issue) => (
            <Typography key={issue} component="li" variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {issue}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  )
}

function Changes({ rows, fromVersion }) {
  const changed = rows.filter(({ changed: isChanged }) => isChanged)

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 1.75, py: 1, bgcolor: 'action.hover' }}>
        <Typography fontWeight={800}>
          {changed.length === 0
            ? 'Compared with version ' + fromVersion
            : `${changed.length} ${changed.length === 1 ? 'change' : 'changes'} from version ${fromVersion}`}
        </Typography>
      </Box>
      {changed.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.75, py: 1.25 }}>
          Edit the form and what differs shows here, before you save.
        </Typography>
      ) : (
        changed.map((row) => (
          <Box
            key={`${row.group}-${row.label}`}
            sx={{ px: 1.75, py: 0.9, borderTop: 1, borderColor: 'divider', borderLeft: 4, borderLeftColor: 'warning.main' }}
          >
            <Typography variant="caption" color="text.secondary" component="div">{row.label}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ textDecoration: 'line-through', overflowWrap: 'anywhere' }}>
              {row.from}
            </Typography>
            <Typography variant="body2" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>{row.to}</Typography>
          </Box>
        ))
      )}
    </Box>
  )
}

/**
 * Beside the form (under it on a phone): whether the setup can be saved and what is missing,
 * for an edit what differs from the version being edited, and the setup as it stands.
 */
export default function SetupLivePanel({ current, issues, isDirty }) {
  const { control } = useFormContext()
  const values = useWatch({ control })
  const setup = setupFromFormValues(values)
  const diff = current ? diffSetups(current, setup) : null

  return (
    <Stack spacing={2}>
      <Status issues={issues} blockedByNoChange={Boolean(current) && !isDirty} />
      {diff && <Changes rows={diff.rows} fromVersion={current.versionNumber} />}
      <BillingSetupSummary setup={setup} title="Summary" compact hideVersion />
    </Stack>
  )
}
