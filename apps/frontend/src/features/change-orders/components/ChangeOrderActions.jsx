import { Link as RouterLink } from 'react-router-dom'
import { Button } from '@mui/material'

import { useAuth } from '../../auth/context/useAuth.js'
import { useChangeOrderMoves } from '../hooks/useChangeOrderMoves.jsx'
import { changeOrderActions } from '../services/changeOrderRecord.js'

/**
 * What can be done with an Extra / CO from its page: edit it and move it between statuses. Only what the
 * person's role may do is shown, and approving or cancelling asks first (cancelling also asks why).
 * `onChanged` reads the Extra / CO again after a move; `onError` receives what went wrong with a move
 * that was made straight from a button.
 */
export default function ChangeOrderActions({ order, onChanged, onError }) {
  const { profile } = useAuth()
  const { canEdit, moves } = changeOrderActions(order.status, profile?.role)
  const { busy, startMove, dialog } = useChangeOrderMoves({ onChanged, onError })

  if (!canEdit && moves.length === 0) return null

  const primary = moves.find((move) => move.to === 'APPROVED' && order.status === 'PENDING')
    ?? moves.find((move) => move.to === 'PENDING')

  return (
    <>
      {canEdit && (
        <Button
          component={RouterLink}
          to={`/change-orders/${order.id}/edit`}
          variant="outlined"
          color="inherit"
          disabled={busy}
        >
          Edit
        </Button>
      )}
      {moves.map((move) => {
        const cancelling = move.to === 'CANCELLED'
        return (
          <Button
            key={move.to}
            variant={move === primary ? 'contained' : cancelling ? 'text' : 'outlined'}
            color={cancelling ? 'error' : move === primary ? 'primary' : 'inherit'}
            disableElevation
            disabled={busy}
            onClick={() => startMove(order, move)}
          >
            {move.label}
          </Button>
        )
      })}
      {dialog}
    </>
  )
}
