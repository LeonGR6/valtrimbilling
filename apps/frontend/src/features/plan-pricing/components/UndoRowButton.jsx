import { IconButton, Tooltip } from '@mui/material'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'

// Takes back what was typed in one row of the sheet while it is being edited.
export default function UndoRowButton({ worksheet, keys, label }) {
  const { evaluation } = worksheet
  const dirty = keys.some((key) => evaluation.changedKeys.has(key) || evaluation.errors.has(key))
  if (!dirty) return null

  return (
    <Tooltip title="Undo changes to this row">
      <IconButton size="small" aria-label={label} onClick={() => worksheet.clearKeys(keys)}>
        <UndoRoundedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}
