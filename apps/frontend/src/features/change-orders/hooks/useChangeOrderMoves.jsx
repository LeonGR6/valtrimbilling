import { useState } from 'react'
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

import {
  CHANGE_ORDER_CANCEL_REASON_MAX,
  cancelReasonProblem,
  toSetStatusRpc,
} from '../services/changeOrderRecord.js'
import { deleteChangeOrder, setChangeOrderStatus } from '../services/changeOrderRepository.js'

/** What deleting is, shaped like a move so one dialog and one code path serve both. */
export const DELETE_MOVE = { to: 'DELETE', label: 'Delete', confirm: true, remove: true }

const CONFIRM_TEXT = {
  APPROVED: 'Once it is approved its lines can no longer be edited. Only an Admin can cancel it afterwards.',
  CANCELLED: 'A cancelled Extra / Change Order cannot be edited or reopened. It stays in the list with the reason.',
  DELETE: 'A Draft is deleted for good, with its lines and its history. It cannot be undone.',
}

const dialogTitle = (move, number) => {
  if (move?.to === 'CANCELLED') return `Cancel ${number}?`
  if (move?.to === 'DELETE') return `Delete ${number}?`
  return `Approve ${number}?`
}

/**
 * Moving an Extra / CO between statuses, or deleting a Draft, from wherever a button or a menu asks for it.
 * `startMove(order, move)` does the move at once or opens the confirmation (approving, cancelling with a
 * reason, deleting); `dialog` is that confirmation, to be put in the page. `onChanged(order, move)` runs
 * after a move was done; `onError(message)` receives what went wrong with a move that was made without
 * asking first. A refusal inside the dialog is shown there.
 */
export function useChangeOrderMoves({ onChanged, onError }) {
  const [confirming, setConfirming] = useState(null)
  const [reason, setReason] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const order = confirming?.order
  const move = confirming?.move
  const reasonProblem = move?.needsReason && attempted ? cancelReasonProblem(reason) : ''

  const closeDialog = () => {
    if (busy) return
    setConfirming(null)
    setReason('')
    setAttempted(false)
    setDialogError('')
  }

  const apply = async (target, targetMove) => {
    if (targetMove.needsReason && cancelReasonProblem(reason)) {
      setAttempted(true)
      return
    }

    setBusy(true)
    setDialogError('')
    onError('')
    try {
      if (targetMove.remove) {
        await deleteChangeOrder(target.id)
      } else {
        await setChangeOrderStatus(toSetStatusRpc(target.id, targetMove.to, targetMove.needsReason ? reason : ''))
      }
      setBusy(false)
      setConfirming(null)
      setReason('')
      setAttempted(false)
      await onChanged(target, targetMove)
    } catch (error) {
      setBusy(false)
      // Someone may have moved it already: show what the database says and what it is now.
      if (targetMove.confirm) setDialogError(error.message)
      else onError(error.message)
      await onChanged(target, null)
    }
  }

  const startMove = (target, targetMove) => (
    targetMove.confirm ? setConfirming({ order: target, move: targetMove }) : apply(target, targetMove)
  )

  const dialog = (
    <Dialog
      open={Boolean(confirming)}
      onClose={closeDialog}
      fullWidth
      maxWidth="xs"
      aria-labelledby="change-order-confirm-title"
    >
      <DialogTitle id="change-order-confirm-title">
        {dialogTitle(move, order?.number)}
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: move?.needsReason ? 2 : 0 }}>
          {CONFIRM_TEXT[move?.to]}
        </DialogContentText>
        {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
        {move?.needsReason && (
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
          color={move?.to === 'CANCELLED' || move?.to === 'DELETE' ? 'error' : 'primary'}
          disabled={busy}
          onClick={() => apply(order, move)}
        >
          {busy ? 'Saving…' : move?.label}
        </Button>
      </DialogActions>
    </Dialog>
  )

  return { busy, startMove, dialog }
}
