import { Alert } from '@mui/material'

function joinNames(names) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Warns that a saved Package mixes a Phase it finishes with others (or finishes several), so it gets
 * the Progress Release as a whole and what it finishes never gets its Final Release. `split` is
 * `{ closing, others }` from `usePackageFinalReleaseSplit`.
 */
export default function PackageFinalReleaseNotice({ split }) {
  if (!split) return null

  const closing = joinNames(split.closing)

  return (
    <Alert severity="warning">
      <strong>This Package should be divided.</strong>
      {split.others.length > 0
        ? ` It finishes ${closing} and also bills ${joinNames(split.others)}, which still ${split.others.length === 1 ? 'has' : 'have'} something left to bill.`
        : ` It finishes ${closing}, and each one it finishes needs a Package of its own.`}
      {' '}With a Final Release per Phase, what a Package finishes goes in a Package of its own,
      with the Final Release and its own invoice. Delete this draft and create it again: Create
      Package proposes the division.
    </Alert>
  )
}
