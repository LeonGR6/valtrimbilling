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
  CHANGE_ORDER_PO_CO_NUMBER_MAX,
  cleanPoCoNumber,
  poCoNumberNotice,
  poCoNumberProblem,
  toSetPoCoNumberRpc,
} from '../services/changeOrderRecord.js'
import { setChangeOrderPoCoNumber } from '../services/changeOrderRepository.js'

/**
 * Writes or changes the PO / CO # of one Extra / CO from its page, also once it is approved. Only this
 * number is saved; nothing else of the Extra / CO changes. `onSaved(message)` runs after it was saved
 * (the page reads the Extra / CO again and says what was done); a refusal is shown inside the dialog.
 */
export default function PoCoNumberDialog({ order, onClose, onSaved }) {
  const [value, setValue] = useState(order.poCoNumber ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const problem = poCoNumberProblem(value)
  const unchanged = cleanPoCoNumber(value) === (order.poCoNumber ?? '')

  const close = () => {
    if (!saving) onClose()
  }

  const save = async () => {
    if (problem || unchanged || saving) return
    setSaving(true)
    setError('')
    try {
      await setChangeOrderPoCoNumber(toSetPoCoNumberRpc(order.id, value))
      setSaving(false)
      await onSaved(poCoNumberNotice(value))
    } catch (failure) {
      setSaving(false)
      setError(failure.message)
    }
  }

  return (
    <Dialog open onClose={close} fullWidth maxWidth="xs" aria-labelledby="po-co-number-title">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        noValidate
      >
        <DialogTitle id="po-co-number-title">
          {order.poCoNumber ? 'Change the PO / CO #' : 'Add the PO / CO #'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            The number the builder gave for {order.number}. Nothing else of it changes.
          </DialogContentText>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="PO / CO #"
            placeholder="1277447-000"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            error={Boolean(problem)}
            helperText={problem || 'Leave it empty to remove it.'}
            slotProps={{
              htmlInput: { 'aria-label': 'PO / CO #', maxLength: CHANGE_ORDER_PO_CO_NUMBER_MAX + 40 },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={close} disabled={saving}>
            Keep it as is
          </Button>
          <Button type="submit" variant="contained" disableElevation disabled={saving || unchanged || Boolean(problem)}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
