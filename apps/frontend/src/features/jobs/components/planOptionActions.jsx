import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'

// `onMoveUp` / `onMoveDown` are null when the Plans cannot be reordered (a
// search is active) and the matching one is disabled at the top / bottom.
export function planActions({
  onEditPlan,
  onDeletePlan,
  onCopyOptions = null,
  onMoveUp = null,
  onMoveDown = null,
  isFirst,
  isLast,
}) {
  const canMove = onMoveUp !== null && onMoveDown !== null
  return [
    ...(canMove ? [
      {
        label: 'Move up',
        icon: <ArrowUpwardRoundedIcon fontSize="small" />,
        onClick: onMoveUp,
        disabled: isFirst,
      },
      {
        label: 'Move down',
        icon: <ArrowDownwardRoundedIcon fontSize="small" />,
        onClick: onMoveDown,
        disabled: isLast,
      },
    ] : []),
    ...(onCopyOptions ? [{
      label: 'Copy options from another plan',
      icon: <ContentCopyRoundedIcon fontSize="small" />,
      onClick: onCopyOptions,
    }] : []),
    {
      label: 'Edit plan',
      icon: <EditOutlinedIcon fontSize="small" />,
      onClick: onEditPlan,
    },
    {
      label: 'Delete plan',
      icon: <DeleteOutlineRoundedIcon fontSize="small" />,
      color: 'error.main',
      onClick: onDeletePlan,
    },
  ]
}

export function optionActions({ onEditOption, onDeleteOption }) {
  return [
    {
      label: 'Edit option',
      icon: <EditOutlinedIcon fontSize="small" />,
      onClick: onEditOption,
    },
    {
      label: 'Delete option',
      icon: <DeleteOutlineRoundedIcon fontSize="small" />,
      color: 'error.main',
      onClick: onDeleteOption,
    },
  ]
}
