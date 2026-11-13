import { Box, Card, Chip, Typography } from '@mui/material'
import { formatDateTime } from '../../utils/drawInvoiceFormatters.js'
import {
  PACKAGE_NOTE_MAX_LENGTH,
  packageNoteAuthor,
  packageNoteErrorMessage,
  packageNoteProblem,
} from '../../services/packageNotesRecord.js'
import { NoteComposer, NoteEntry } from '../shared/NotesThread.jsx'
import { TableCardHeader } from '../shared/PackageUi.jsx'

/**
 * The internal notes of a Package, newest first, each with who wrote it and when. The note written
 * while the Package was created is the first of them. Whoever can add notes (`canAdd`) also sees the
 * box to write one. `onAdd(body)` saves it; the notes are not printed on the Package's documents and
 * are not sent to QuickBooks.
 */
export default function PackageNotes({ package: record, canAdd, onAdd }) {
  const notes = record.noteEntries ?? []

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <TableCardHeader
        title="Notes"
        description="Internal. Only the team sees them; they are not printed or sent to QuickBooks."
        chip={<Chip size="small" variant="outlined" label={notes.length} />}
      />
      {canAdd && (
        <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <NoteComposer
            onAdd={onAdd}
            maxLength={PACKAGE_NOTE_MAX_LENGTH}
            problemOf={packageNoteProblem}
            errorMessage={packageNoteErrorMessage}
          />
        </Box>
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
