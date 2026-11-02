import { useState } from 'react'
import { Alert, Box, Button, Chip, Stack, TextField, Typography } from '@mui/material'

// The pieces of a thread of internal notes, shared by the notes of a Package and of a Job so both
// look and behave the same: an entry says who wrote it and when, and the box adds a new one.

/** One note: its author, the moment, the text, and an optional tag (the Package it was written on). */
export function NoteEntry({ author, moment, body, tag }) {
  return (
    <Box
      component="li"
      sx={{
        px: { xs: 2, sm: 2.5 },
        py: 1.25,
        '& + &': { borderTop: 1, borderColor: 'divider' },
      }}
    >
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography variant="body2" fontWeight={800}>{author}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {moment}
        </Typography>
        {tag && <Chip size="small" variant="outlined" label={tag} sx={{ alignSelf: 'center' }} />}
      </Stack>
      <Typography variant="body2" sx={{ mt: 0.25, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {body}
      </Typography>
    </Box>
  )
}

/**
 * The box that writes a note. `onAdd(body)` saves it and throws when it cannot; `problemOf(body)` says
 * why the text cannot be saved yet (empty when it can); `errorMessage(error)` is what the person is
 * told when saving fails. Ctrl+Enter adds it.
 */
export function NoteComposer({
  onAdd,
  maxLength,
  problemOf,
  errorMessage,
  placeholder = 'A call, a promise to pay, a missing document…',
  minRows = 2,
}) {
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const problem = problemOf(draft)

  const submit = async () => {
    if (problem || submitting) return
    setSubmitting(true)
    setError('')
    try {
      await onAdd(draft)
      setDraft('')
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Stack spacing={1}>
      <TextField
        label="Add a note"
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          }
        }}
        disabled={submitting}
        multiline
        minRows={minRows}
        maxRows={8}
        fullWidth
        helperText={`${draft.trim().length}/${maxLength} · Ctrl+Enter to add`}
        slotProps={{ htmlInput: { maxLength } }}
      />
      {error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Button variant="contained" size="small" onClick={submit} disabled={Boolean(problem) || submitting}>
          {submitting ? 'Adding…' : 'Add note'}
        </Button>
      </Box>
    </Stack>
  )
}
