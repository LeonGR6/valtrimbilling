import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Collapse,
  Paper,
  Skeleton,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded'
import { usePersistentState } from '../../../../hooks/usePersistentState.js'
import { useJobNotes } from '../../hooks/useJobNotes.js'
import {
  JOB_NOTE_MAX_LENGTH,
  collectJobPackageNotes,
  jobNoteAuthor,
  jobNoteErrorMessage,
  jobNoteProblem,
  notePreview,
  summarizeJobNotes,
} from '../../services/jobNotesRecord.js'
import { formatDateTime } from '../../utils/drawInvoiceFormatters.js'
import { NoteComposer, NoteEntry } from '../shared/NotesThread.jsx'

const HISTORY_MAX_HEIGHT = 260

function NoteSkeletons() {
  return (
    <Stack spacing={1.5} sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5 }} aria-hidden="true">
      {[0, 1].map((row) => (
        <Stack key={row} spacing={0.75}>
          <Skeleton variant="rounded" width={row === 0 ? 180 : 150} height={14} />
          <Skeleton variant="rounded" width={row === 0 ? '78%' : '52%'} height={14} />
        </Stack>
      ))}
    </Stack>
  )
}

// The list scrolls when it is long. A soft shadow on the edge that has more beyond it says so,
// and goes away at the end of the list (the covers move with the content, the shadows stay put).
function ThreadList({ label, children }) {
  return (
    <Box
      component="ol"
      tabIndex={0}
      aria-label={label}
      sx={(theme) => {
        const paper = theme.palette.background.paper
        const shadow = alpha(theme.palette.text.primary, 0.16)

        return {
          m: 0,
          p: 0,
          listStyle: 'none',
          maxHeight: HISTORY_MAX_HEIGHT,
          overflowY: 'auto',
          backgroundColor: paper,
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% 36px, 100% 36px, 100% 10px, 100% 10px',
          backgroundPosition: '0 0, 0 100%, 0 0, 0 100%',
          backgroundAttachment: 'local, local, scroll, scroll',
          backgroundImage: [
            `linear-gradient(${paper} 30%, transparent)`,
            `linear-gradient(transparent, ${paper} 70%)`,
            `radial-gradient(farthest-side at 50% 0, ${shadow}, transparent)`,
            `radial-gradient(farthest-side at 50% 100%, ${shadow}, transparent)`,
          ].join(', '),
          '&:focus-visible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main', outlineOffset: -2 },
        }
      }}
    >
      {children}
    </Box>
  )
}

/**
 * What the team left about a Job, at hand while a Package is created: the history of its notes,
 * newest first, and the box to add one. A note is saved as soon as it is added, not with the Package,
 * so a reminder is not lost if the dialog is closed. The notes written on the Job's Packages can be
 * read under it. The panel keeps its open or closed state between visits; closed, it still shows the
 * latest note.
 */
export default function JobNotesPanel({ job, packages }) {
  const { notes, loading, error, add, reload } = useJobNotes(job.id)
  const [open, setOpen] = usePersistentState(
    'draw-invoice.job-notes-open',
    true,
    (value) => typeof value === 'boolean',
  )
  const [packageNotesOpen, setPackageNotesOpen] = useState(false)
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const packageNotes = useMemo(() => collectJobPackageNotes(packages, job.id), [packages, job.id])
  const { count, latest } = summarizeJobNotes(notes)

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <ButtonBase
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="job-notes-body"
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
        <StickyNote2RoundedIcon color="action" />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography fontWeight={800}>Job #{job.code} notes</Typography>
            <Chip size="small" variant="outlined" label={loading ? '…' : error ? '–' : count} />
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {open || !latest
              ? 'Internal. Only the team sees them; they are not printed or sent to QuickBooks.'
              : `${jobNoteAuthor(latest)} · ${formatDateTime(latest.createdAt)}: ${notePreview(latest)}`}
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
        <Box id="job-notes-body" sx={{ borderTop: 1, borderColor: 'divider' }}>
          {loading ? (
            <NoteSkeletons />
          ) : error ? (
            <Alert
              severity="warning"
              sx={{ m: 1.5 }}
              action={<Button color="inherit" size="small" onClick={reload}>Retry</Button>}
            >
              {error}
            </Alert>
          ) : count === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5 }}>
              No notes on this Job yet. Leave one so the next person knows what it needs.
            </Typography>
          ) : (
            <ThreadList label={`History of the notes of Job #${job.code}`}>
              {notes.map((note) => (
                <NoteEntry
                  key={note.id}
                  author={jobNoteAuthor(note)}
                  moment={formatDateTime(note.createdAt)}
                  body={note.body}
                />
              ))}
            </ThreadList>
          )}

          <Box
            sx={{
              px: { xs: 2, sm: 2.5 },
              py: 1.5,
              borderTop: loading || count > 0 || error ? 1 : 0,
              borderColor: 'divider',
            }}
          >
            <NoteComposer
              onAdd={add}
              maxLength={JOB_NOTE_MAX_LENGTH}
              problemOf={jobNoteProblem}
              errorMessage={jobNoteErrorMessage}
              minRows={1}
            />
          </Box>

          {packageNotes.length > 0 && (
            <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
              <Button
                size="small"
                color="inherit"
                onClick={() => setPackageNotesOpen((current) => !current)}
                aria-expanded={packageNotesOpen}
                endIcon={(
                  <ExpandMoreRoundedIcon
                    sx={{ transform: packageNotesOpen ? 'rotate(180deg)' : 'none' }}
                  />
                )}
                sx={{ px: { xs: 2, sm: 2.5 }, py: 1, width: '100%', justifyContent: 'space-between', color: 'text.secondary' }}
              >
                Notes on this Job&apos;s Packages ({packageNotes.length})
              </Button>
              <Collapse in={packageNotesOpen} timeout={reduceMotion ? 0 : 'auto'} unmountOnExit>
                <ThreadList label={`Notes on the Packages of Job #${job.code}`}>
                  {packageNotes.map((note) => (
                    <NoteEntry
                      key={note.key}
                      author={jobNoteAuthor(note)}
                      moment={formatDateTime(note.createdAt)}
                      body={note.body}
                      tag={note.packageNumber}
                    />
                  ))}
                </ThreadList>
              </Collapse>
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}
