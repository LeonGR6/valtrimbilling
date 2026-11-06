import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Collapse,
  Paper,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded'
import { usePersistentState } from '../../../hooks/usePersistentState.js'
import {
  NoteComposer,
  NoteEntry,
  NoteSkeletons,
  NoteThreadList,
} from '../../draw-invoice/components/shared/NotesThread.jsx'
import { notePreview } from '../../draw-invoice/services/jobNotesRecord.js'
import { formatDateTime } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { usePlanOptionNotes } from '../hooks/usePlanOptionNotes.js'
import {
  NOTE_KINDS,
  PLAN_OPTION_NOTE_MAX_LENGTH,
  notesOfKind,
  planOptionNoteAuthor,
  planOptionNoteErrorMessage,
  planOptionNoteProblem,
} from '../services/planOptionNotesRecord.js'

const THREADS = [
  {
    kind: NOTE_KINDS.PLANS,
    id: 'plan-notes',
    title: 'Plan notes',
    icon: <LayersRoundedIcon color="action" />,
    empty: 'No notes on the Plans yet.',
    placeholder: 'A revision, a Plan the Builder dropped, a drawing that is missing…',
  },
  {
    kind: NOTE_KINDS.OPTIONS,
    id: 'option-notes',
    title: 'Option notes',
    icon: <StickyNote2RoundedIcon color="action" />,
    empty: 'No notes on the Options yet.',
    placeholder: 'A price pending, an Option the Builder changed, a vendor quote…',
  },
]

function NoteThread({ thread, jobCode, notes, loading, error, canAdd, onAdd, onRetry }) {
  const [open, setOpen] = usePersistentState(
    `jobs.${thread.id}-open`,
    false,
    (value) => typeof value === 'boolean',
  )
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const latest = notes[0] ?? null
  const bodyId = `${thread.id}-body`

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', minWidth: 0 }}>
      <ButtonBase
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          width: '100%',
          px: { xs: 2, sm: 2.5 },
          py: 1.25,
          textAlign: 'left',
          '&.Mui-focusVisible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main', outlineOffset: -2 },
        }}
      >
        {thread.icon}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography fontWeight={800}>{thread.title}</Typography>
            <Chip size="small" variant="outlined" label={loading ? '…' : error ? '–' : notes.length} />
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {open || !latest
              ? 'Internal. Who wrote each note and when is kept.'
              : `${planOptionNoteAuthor(latest)} · ${formatDateTime(latest.createdAt)}: ${notePreview(latest, 70)}`}
          </Typography>
        </Box>
        <ExpandMoreRoundedIcon
          sx={{
            transform: open ? 'rotate(180deg)' : 'none',
            '@media (prefers-reduced-motion: no-preference)': { transition: 'transform 150ms' },
          }}
        />
      </ButtonBase>

      <Collapse in={open} timeout={reduceMotion ? 0 : 'auto'} unmountOnExit>
        <Box id={bodyId} sx={{ borderTop: 1, borderColor: 'divider' }}>
          {loading ? (
            <NoteSkeletons />
          ) : error ? (
            <Alert
              severity="warning"
              sx={{ m: 1.5 }}
              action={<Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}
            >
              {error}
            </Alert>
          ) : notes.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5 }}>
              {thread.empty}
            </Typography>
          ) : (
            <NoteThreadList label={`History of the ${thread.title.toLowerCase()} of Job ${jobCode}`}>
              {notes.map((note) => (
                <NoteEntry
                  key={note.id}
                  author={planOptionNoteAuthor(note)}
                  moment={formatDateTime(note.createdAt)}
                  body={note.body}
                />
              ))}
            </NoteThreadList>
          )}

          {canAdd && !loading && !error && (
            <Box
              sx={{
                px: { xs: 2, sm: 2.5 },
                py: 1.5,
                borderTop: notes.length > 0 ? 1 : 0,
                borderColor: 'divider',
              }}
            >
              <NoteComposer
                onAdd={(body) => onAdd(thread.kind, body)}
                maxLength={PLAN_OPTION_NOTE_MAX_LENGTH}
                problemOf={planOptionNoteProblem}
                errorMessage={planOptionNoteErrorMessage}
                placeholder={thread.placeholder}
                minRows={1}
              />
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

/**
 * The notes of the Plans and of the Options of a Job, each in its own card with its history: who wrote
 * every note, on which day and at what time. The roles that keep the Plans add them; everyone else reads.
 */
export default function PlanOptionNotes({ job, canAdd }) {
  const { notes, loading, error, add, reload } = usePlanOptionNotes(job.id)

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        mb: 2.5,
        alignItems: 'start',
        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
      }}
    >
      {THREADS.map((thread) => (
        <NoteThread
          key={thread.kind}
          thread={thread}
          jobCode={job.code}
          notes={notesOfKind(notes, thread.kind)}
          loading={loading}
          error={error}
          canAdd={canAdd}
          onAdd={add}
          onRetry={reload}
        />
      ))}
    </Box>
  )
}
