import { Alert, AlertTitle, Box, Chip, Stack, Typography } from '@mui/material'
import { plural } from '../../../../utils/plural.js'

const TYPE_LABELS = { PROGRESS: 'Progress Release', FINAL: 'Final Release' }
const SCOPE_NAMES = { PHASE: 'Phase', BUILDING: 'Building' }

function joinNames(names) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Says why the selection needs more than one Package and which ones. A Builder with a single invoice
 * per Phase (or Building) gets a Package for each one the selection touches, with what was chosen of
 * it and its own invoice. With a Final Release per Phase (or per Building), each Phase the cells
 * finish goes in a Package of its own, with the Final Release and its own invoice, and what still
 * has something to bill stays together with the Progress Release. Options that no Draw of the
 * Package can carry are billed on an Options Package of their own.
 *
 * `packages` is the result of `planCreatedPackages`; `invoiceScope` and `finalScope` are `PHASE`,
 * `BUILDING` or null; `optionsDrawNumber` is the Options billing Draw, as a person counts it.
 */
export default function PackageSplitNotice({
  packages,
  invoiceScope = null,
  finalScope = null,
  optionsDrawNumber = null,
}) {
  const drawPackages = packages.filter(({ kind }) => kind === 'DRAW')
  const optionsPackages = packages.filter(({ kind }) => kind === 'OPTIONS')
  const finals = drawPackages.filter(({ group }) => group?.type === 'FINAL')
  const hasProgress = drawPackages.some(({ group }) => group?.type === 'PROGRESS')
  const finished = joinNames(finals.map(({ group }) => group.label))
  const optionsDraw = optionsDrawNumber == null ? 'the Options Draw' : `Draw #${optionsDrawNumber}`

  return (
    <Alert severity="warning">
      <AlertTitle>This selection needs {packages.length} Packages</AlertTitle>
      <Typography variant="body2">
        {drawPackages.length > 1 && (invoiceScope ? (
          <>
            This Builder takes a single invoice per {SCOPE_NAMES[invoiceScope]}, so what you selected of
            each {SCOPE_NAMES[invoiceScope]} goes in a Package of its own, with its own invoice.
            {finals.length > 0
              ? ` ${finished} ${finals.length === 1 ? 'is' : 'are'} finished by these cells, so ${finals.length === 1 ? 'its Package gets' : 'their Packages get'} the Final Release.`
              : ''}
          </>
        ) : (
          <>
            This Builder asks for a Final Release per {SCOPE_NAMES[finalScope] ?? 'Phase'}. {finished}{' '}
            {finals.length === 1 ? 'is' : 'are'} finished by these cells, so{' '}
            {finals.length === 1 ? 'it goes' : 'each goes'} in a Package of its own, with the Final Release
            and its own invoice.
            {hasProgress ? ' What still has something left to bill goes together in another Package, with the Progress Release.' : ''}
          </>
        ))}
        {optionsPackages.length > 0 && (
          <>
            {drawPackages.length > 1 ? ' ' : ''}
            {invoiceScope && drawPackages.length > 0
              ? `An Option is never billed on another ${SCOPE_NAMES[invoiceScope]}'s invoice. The ones whose ${SCOPE_NAMES[invoiceScope]} has no Draw at or after ${optionsDraw} in this selection go in `
              : 'Options with no Lot / Draw cell to ride on go in '}
            {optionsPackages.length === 1 ? 'an Options Package' : 'Options Packages'} of their own: their
            Lots already reached {optionsDraw}.
          </>
        )}
        {' '}They are created together.
      </Typography>
      <Stack component="ol" spacing={0.75} sx={{ m: 0, mt: 1.25, p: 0, listStyle: 'none' }}>
        {packages.map(({ kind, group, input }, index) => {
          const options = kind === 'OPTIONS'
          return (
            <Box
              key={`${kind}:${group?.type}:${group?.scopeKeys?.join(',')}`}
              component="li"
              sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
            >
              <Typography variant="body2" fontWeight={750}>
                Package {index + 1}: {group?.label ?? 'Draw'}
              </Typography>
              {options && <Chip size="small" variant="outlined" label="Options only" />}
              {!options && group?.type && (
                <Chip
                  size="small"
                  color={group.type === 'FINAL' ? 'success' : 'default'}
                  variant={group.type === 'FINAL' ? 'filled' : 'outlined'}
                  label={TYPE_LABELS[group.type]}
                />
              )}
              <Typography variant="body2" color="text.secondary">
                {options
                  ? plural(input.optionSelections.length, 'option')
                  : plural(
                    (input.selections?.length ?? 0) + (input.hardwareSelections?.length ?? 0),
                    'cell or charge',
                    'cells and charges',
                  )}
              </Typography>
            </Box>
          )
        })}
      </Stack>
    </Alert>
  )
}
