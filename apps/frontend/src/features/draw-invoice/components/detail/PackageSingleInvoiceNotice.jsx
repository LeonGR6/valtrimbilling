import { Alert } from '@mui/material'

function joinNames(names) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Warns that a saved draft bills several Phases (or Buildings) on one invoice although the Builder
 * takes a single invoice for each. `split` is `{ scope, labels }` from `describeSavedInvoiceSplit`.
 */
export default function PackageSingleInvoiceNotice({ split }) {
  if (!split) return null

  const level = split.scope === 'PHASE' ? 'Phase' : 'Building'

  return (
    <Alert severity="warning">
      <strong>This Package should be divided.</strong>
      {` It bills ${joinNames(split.labels)} together, but this Builder takes a single invoice per ${level}. `}
      Delete this draft and create it again: Create Package proposes one Package for each {level}.
    </Alert>
  )
}
