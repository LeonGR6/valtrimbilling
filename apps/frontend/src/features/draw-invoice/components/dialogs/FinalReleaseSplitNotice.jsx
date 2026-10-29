import { Alert, AlertTitle, Box, Chip, Stack, Typography } from '@mui/material'
import { plural } from '../../../../utils/plural.js'

const TYPE_LABELS = { PROGRESS: 'Progress Release', FINAL: 'Final Release' }
const SCOPE_NAMES = { PHASE: 'Phase', BUILDING: 'Building' }

function joinNames(names) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Says why the selection needs more than one Package and which ones: with a Final Release per Phase
 * (or per Building), each Phase the cells finish goes in a Package of its own, with the Final Release
 * and its own invoice, and what still has something to bill stays together with the Progress Release.
 * `split` is the result of `splitPackageInput`; `scope` is `PHASE` or `BUILDING`.
 */
export default function FinalReleaseSplitNotice({ split, scope }) {
  const finals = split.packages.filter(({ group }) => group.type === 'FINAL')
  const hasProgress = split.packages.some(({ group }) => group.type === 'PROGRESS')
  const finished = joinNames(finals.map(({ group }) => group.label))

  return (
    <Alert severity="warning">
      <AlertTitle>This selection needs {split.packages.length} Packages</AlertTitle>
      <Typography variant="body2">
        This Builder asks for a Final Release per {SCOPE_NAMES[scope] ?? 'Phase'}. {finished}{' '}
        {finals.length === 1 ? 'is' : 'are'} finished by these cells, so{' '}
        {finals.length === 1 ? 'it goes' : 'each goes'} in a Package of its own, with the Final Release
        and its own invoice.
        {hasProgress ? ' What still has something left to bill goes together in another Package, with the Progress Release.' : ''}
        {' '}They are created together.
      </Typography>
      <Stack component="ol" spacing={0.75} sx={{ m: 0, mt: 1.25, p: 0, listStyle: 'none' }}>
        {split.packages.map(({ group, input }, index) => {
          const items = input.selections.length + input.hardwareSelections.length
          return (
            <Box
              key={`${group.type}:${group.scopeKeys.join(',')}`}
              component="li"
              sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
            >
              <Typography variant="body2" fontWeight={750}>
                Package {index + 1}: {group.label}
              </Typography>
              <Chip
                size="small"
                color={group.type === 'FINAL' ? 'success' : 'default'}
                variant={group.type === 'FINAL' ? 'filled' : 'outlined'}
                label={TYPE_LABELS[group.type]}
              />
              <Typography variant="body2" color="text.secondary">
                {plural(items, 'cell or charge', 'cells and charges')}
              </Typography>
            </Box>
          )
        })}
      </Stack>
      {split.unplacedOptions > 0 && (
        <Typography variant="body2" sx={{ mt: 1.25 }}>
          {plural(split.unplacedOptions, 'option')} cannot be billed
          in these Packages (none has a Draw at or after the Options Draw), so
          {' '}{split.unplacedOptions === 1 ? 'it stays' : 'they stay'} pending.
        </Typography>
      )}
    </Alert>
  )
}
