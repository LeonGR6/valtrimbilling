import { useState } from 'react'
import { Alert, Box, Button, Card, Chip, Stack, TextField, Typography } from '@mui/material'
import { formatDateTime } from '../../utils/drawInvoiceFormatters.js'
import {
  PACKAGE_NOTE_MAX_LENGTH,
  packageNoteAuthor,
  packageNoteErrorMessage,
  packageNoteProblem,
} from '../../services/packageNotesRecord.js'
import { TableCardHeader } from '../shared/PackageUi.jsx'

function NoteEntry({ author, moment, body }) {
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
      </Stack>
      <Typography variant="body2" sx={{ mt: 0.25, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {body}
      </Typography>
    </Box>
  )
}

/**
 * The internal notes of a Package, newest first, each with who wrote it and when. The note written
 * while the Package was created is the first of them. Whoever can add notes (`canAdd`) also sees the
 * box to write one. `onAdd(body)` saves it; the notes are not printed on the Package's documents and
 * are not sent to QuickBooks.
 */
export default function PackageNotes({ package: record, canAdd, onAdd }) {
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const notes = record.noteEntries ?? []
  const problem = packageNoteProblem(draft)

  const submit = async () => {
    if (problem || submitting) return
    setSubmitting(true)
    setError('')
    try {
      await onAdd(draft)
      setDraft('')
    } catch (saveError) {
      setError(packageNoteErrorMessage(saveError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <TableCardHeader
        title="Notes"
        description="Internal. Only the team sees them; they are not printed or sent to QuickBooks."
        chip={<Chip size="small" variant="outlined" label={notes.length} />}
      />
      {canAdd && (
        <Stack spacing={1} sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            label="Add a note"
            placeholder="A call, a promise to pay, a missing document…"
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
            minRows={2}
            maxRows={8}
            fullWidth
            helperText={`${draft.trim().length}/${PACKAGE_NOTE_MAX_LENGTH} · Ctrl+Enter to add`}
            slotProps={{ htmlInput: { maxLength: PACKAGE_NOTE_MAX_LENGTH } }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Box>
            <Button variant="contained" size="small" onClick={submit} disabled={Boolean(problem) || submitting}>
              {submitting ? 'Adding…' : 'Add note'}
            </Button>
          </Box>
        </Stack>
      )}
      {notes.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5 }}>
          {canAdd
            ? 'No notes yet. Leave one so the next person knows what happened with this Package.'
            : 'No notes yet.'}
        </Typography>
      ) : (
        <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {notes.map((note) => (
            <NoteEntry
              key={note.id}
              author={packageNoteAuthor(note)}
              moment={formatDateTime(note.createdAt)}
              body={note.body}
            />
          ))}
        </Box>
      )}
    </Card>
  )
}
