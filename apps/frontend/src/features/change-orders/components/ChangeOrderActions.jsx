import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material'

import { useAuth } from '../../auth/context/useAuth.js'
import {
  CHANGE_ORDER_CANCEL_REASON_MAX,
  cancelReasonProblem,
  changeOrderActions,
  toSetStatusRpc,
} from '../services/changeOrderRecord.js'
import { setChangeOrderStatus } from '../services/changeOrderRepository.js'

const CONFIRM_TEXT = {
  APPROVED: 'Once it is approved its lines can no longer be edited. Only an Admin can cancel it afterwards.',
  CANCELLED: 'A cancelled Extra / Change Order cannot be edited or reopened. It stays in the list with the reason.',
}

/**
 * What can be done with an Extra / CO from its page: edit it and move it between statuses. Only what the
 * person's role may do is shown, and approving or cancelling asks first (cancelling also asks why).
 * `onChanged` reads the Extra / CO again after a move; `onError` receives what went wrong with a move
 * that was made straight from a button.
 */
export default function ChangeOrderActions({ order, onChanged, onError }) {
  const { profile } = useAuth()
  const { canEdit, moves } = changeOrderActions(order.status, profile?.role)

  const [confirming, setConfirming] = useState(null)
  const [reason, setReason] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')

  if (!canEdit && moves.length === 0) return null

  const reasonProblem = confirming?.needsReason && attempted ? cancelReasonProblem(reason) : ''

  const closeDialog = () => {
    if (busy) return
    setConfirming(null)
    setReason('')
    setAttempted(false)
    setDialogError('')
  }

  const apply = async (move) => {
    if (move.needsReason && cancelReasonProblem(reason)) {
      setAttempted(true)
      return
    }

    setBusy(true)
    setDialogError('')
    onError('')
    try {
      await setChangeOrderStatus(toSetStatusRpc(order.id, move.to, move.needsReason ? reason : ''))
      setBusy(false)
      setConfirming(null)
      setReason('')
      setAttempted(false)
      await onChanged()
    } catch (error) {
      setBusy(false)
      // Someone may have moved it already: show what the database says and what it is now.
      if (move.confirm) setDialogError(error.message)
      else onError(error.message)
      await onChanged()
    }
  }

  const handleMove = (move) => (move.confirm ? setConfirming(move) : apply(move))

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
            onClick={() => handleMove(move)}
          >
            {move.label}
          </Button>
        )
      })}

      <Dialog
        open={Boolean(confirming)}
        onClose={closeDialog}
        fullWidth
        maxWidth="xs"
        aria-labelledby="change-order-confirm-title"
      >
        <DialogTitle id="change-order-confirm-title">
          {confirming?.to === 'CANCELLED' ? `Cancel ${order.number}?` : `Approve ${order.number}?`}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: confirming?.needsReason ? 2 : 0 }}>
            {CONFIRM_TEXT[confirming?.to]}
          </DialogContentText>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          {confirming?.needsReason && (
            <TextField
              autoFocus
              fullWidth
              multiline
              minRows={2}
              size="small"
              label="Reason for cancelling"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              error={Boolean(reasonProblem)}
              helperText={reasonProblem || `${reason.trim().length} / ${CHANGE_ORDER_CANCEL_REASON_MAX}`}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={closeDialog} disabled={busy}>
            Keep it as is
          </Button>
          <Button
            variant="contained"
            disableElevation
            color={confirming?.to === 'CANCELLED' ? 'error' : 'primary'}
            disabled={busy}
            onClick={() => apply(confirming)}
          >
            {busy ? 'Saving…' : confirming?.label}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
