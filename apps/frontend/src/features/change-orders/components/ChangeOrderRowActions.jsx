import { useNavigate } from 'react-router-dom'
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'

import { RowActionsMenu } from '../../../components/common/CatalogPage'
import { DELETE_MOVE } from '../hooks/useChangeOrderMoves.jsx'
import { changeOrderActions } from '../services/changeOrderRecord.js'

const MOVE_ICONS = {
  PENDING: <SendOutlinedIcon fontSize="small" />,
  DRAFT: <UndoRoundedIcon fontSize="small" />,
  APPROVED: <CheckCircleOutlineRoundedIcon fontSize="small" />,
  CANCELLED: <BlockRoundedIcon fontSize="small" />,
}

/**
 * What can be done with one Extra / CO from the list, in groups: look at it and edit it; move it forward
 * or back; cancel or delete it. Only what the role and the status allow is offered (the database allows
 * the same). `onMove(order, move)` starts a move, or the deletion with `DELETE_MOVE`.
 */
export default function ChangeOrderRowActions({ order, role, onMove }) {
  const navigate = useNavigate()
  const { canEdit, canDelete, moves } = changeOrderActions(order.status, role)
  const forward = moves.filter((move) => move.to !== 'CANCELLED')
  const cancel = moves.find((move) => move.to === 'CANCELLED')

  const items = [
    {
      label: 'Open',
      icon: <VisibilityOutlinedIcon fontSize="small" />,
      onClick: () => navigate(`/change-orders/${order.id}`),
    },
    canEdit && {
      label: 'Edit',
      icon: <EditOutlinedIcon fontSize="small" />,
      onClick: () => navigate(`/change-orders/${order.id}/edit`),
    },
    ...forward.map((move, index) => ({
      label: move.label,
      icon: MOVE_ICONS[move.to],
      onClick: () => onMove(order, move),
      dividerBefore: index === 0,
    })),
    cancel && {
      label: cancel.label,
      icon: MOVE_ICONS.CANCELLED,
      color: 'error.main',
      onClick: () => onMove(order, cancel),
      dividerBefore: true,
    },
    canDelete && {
      label: 'Delete',
      icon: <DeleteOutlineRoundedIcon fontSize="small" />,
      color: 'error.main',
      onClick: () => onMove(order, DELETE_MOVE),
      dividerBefore: !cancel,
    },
  ].filter(Boolean)

  return <RowActionsMenu label={`Actions for ${order.number}`} items={items} />
}
