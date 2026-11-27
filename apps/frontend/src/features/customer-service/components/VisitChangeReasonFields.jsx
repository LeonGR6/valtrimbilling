import {
  Autocomplete, FormControl, FormHelperText, InputLabel, MenuItem, Select, Stack, TextField,
} from '@mui/material'
import {
  duplicateCandidates, visitChangeNoteLimit, visitChangeReasonOptions,
} from '../utils/customerServiceVisitChanges.js'

// Why a visit moves or is cancelled, or why a request closes (Reschedule block, 27 Nov 2026):
// the reason, an internal note (required for Other) and, for a duplicate, the original.
// value: { reason, note, duplicateOfRequestId }. reasons: the codes this action accepts.
// asksOriginal: show the original request when the reason is Duplicate.
export default function VisitChangeReasonFields({
  idPrefix, reasons, value, onChange, request, requests = [], asksOriginal = false, disabled = false,
}) {
  const options = visitChangeReasonOptions(reasons)
  const showOriginal = asksOriginal && value.reason === 'DUPLICATE'
  const candidates = showOriginal ? duplicateCandidates(requests, request) : []
  const original = candidates.find((entry) => String(entry.id) === String(value.duplicateOfRequestId)) ?? null
  const noteRequired = value.reason === 'OTHER'
  return (
    <Stack spacing={2}>
      <FormControl fullWidth size="small" required disabled={disabled}>
        <InputLabel id={`${idPrefix}-reason`}>Reason</InputLabel>
        <Select labelId={`${idPrefix}-reason`} label="Reason" value={value.reason}
          onChange={(event) => onChange({ ...value, reason: event.target.value, duplicateOfRequestId: null })}>
          {options.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
        </Select>
      </FormControl>
      {showOriginal && (
        <Autocomplete
          options={candidates} value={original} disabled={disabled} size="small"
          getOptionLabel={(entry) => [entry.requestNumber, entry.contactName, entry.community].filter(Boolean).join(' · ')}
          isOptionEqualToValue={(option, selected) => String(option.id) === String(selected.id)}
          onChange={(_event, entry) => onChange({ ...value, duplicateOfRequestId: entry?.id ?? null })}
          renderInput={(params) => (
            <TextField {...params} label="Original request" required
              helperText="The request this one repeats. It stays open." />
          )}
        />
      )}
      <FormControl fullWidth>
        <TextField
          label={noteRequired ? 'Note' : 'Note (optional)'} required={noteRequired} multiline minRows={2} size="small"
          value={value.note} disabled={disabled}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
          slotProps={{ htmlInput: { maxLength: visitChangeNoteLimit } }}
        />
        <FormHelperText>Internal: kept in the request&apos;s history. The customer does not see it.</FormHelperText>
      </FormControl>
    </Stack>
  )
}
