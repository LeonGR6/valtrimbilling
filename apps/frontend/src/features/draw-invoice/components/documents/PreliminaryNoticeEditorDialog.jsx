import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  AppBar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  ToggleButton,
  Toolbar,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import { notifyJobDocumentsChanged } from '../../services/jobDocumentEvents.js'
import {
  downloadJobDocumentBytes,
  listJobPreliminaryNotices,
  uploadJobDocument,
} from '../../services/jobDocumentsRepository.js'
import {
  DEFAULT_FONT_SIZE,
  buildFieldEntries,
  LINE_HEIGHT_EM,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  clampFontSize,
  describeEntriesProblem,
  filledNoticeFileName,
  readNoticePages,
  writableEntries,
  writeNoticeText,
} from '../../services/preliminaryNoticePdf.js'
import { detectNoticeFields } from '../../services/preliminaryNoticeFieldsLoader.js'
import { MAX_JOB_DOCUMENT_SIZE } from '../../services/jobDocumentRecord.js'
import { formatFileSize } from './jobDocumentTypes.js'
import PreliminaryNoticePages from './PreliminaryNoticePages.jsx'

let entryCounter = 0
const newEntryId = () => {
  entryCounter += 1
  return `entry-${entryCounter}`
}

function SourcePicker({ job, documents, loading, error, busy, onFile, onExisting }) {
  const inputRef = useRef(null)

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 560, mx: 'auto', py: 4 }}>
      <Box>
        <Typography variant="h6" fontWeight={850}>Preliminary Notice</Typography>
        <Typography color="text.secondary">
          Job #{job.code}. Upload the PDF, click where text goes on its pages and type it,
          then save it as the Job&apos;s Preliminary Notice.
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      <Box>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onFile(file)
          }}
        />
        <Button
          variant="contained"
          disableElevation
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <UploadFileRoundedIcon />}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Upload a PDF to fill in
        </Button>
      </Box>
      <Box>
        <Typography fontWeight={800} sx={{ mb: 1 }}>Already uploaded for this Job</Typography>
        {loading && <CircularProgress size={22} />}
        {!loading && documents.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No Preliminary Notice uploaded yet.
          </Typography>
        )}
        <Stack spacing={1}>
          {documents.map((document) => (
            <Paper
              key={document.id}
              variant="outlined"
              sx={{ p: 1.25, display: 'flex', alignItems: 'center', gap: 1.5 }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap fontWeight={700}>{document.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatFileSize(document.sizeBytes)}
                </Typography>
              </Box>
              <Button size="small" disabled={busy} onClick={() => onExisting(document)}>
                Fill in
              </Button>
            </Paper>
          ))}
        </Stack>
      </Box>
    </Stack>
  )
}

/**
 * Fills in a Job's Preliminary Notice like a simple PDF editor: the user puts
 * text anywhere on the pages and saves the result as a Job document. The PDF is
 * either uploaded here or one the Job already has; either way the filled copy is
 * saved as a new Preliminary Notice and the original is left alone.
 */
export default function PreliminaryNoticeEditorDialog({ job, canManage = true, onClose, onSaved }) {
  const [documents, setDocuments] = useState([])
  const [loadingDocuments, setLoadingDocuments] = useState(true)
  const [source, setSource] = useState(null)
  const [opening, setOpening] = useState(false)
  const [entries, setEntries] = useState([])
  // The blanks and check boxes found on the PDF, and what was typed in them.
  const [fields, setFields] = useState([])
  const [fieldValues, setFieldValues] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [focusId, setFocusId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const lastFontSize = useRef(DEFAULT_FONT_SIZE)

  useEffect(() => {
    let cancelled = false
    listJobPreliminaryNotices(job.id)
      .then((next) => {
        if (!cancelled) setDocuments(next)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingDocuments(false)
      })
    return () => {
      cancelled = true
    }
  }, [job.id])

  const open = async ({ name, load, existing }) => {
    setOpening(true)
    setError(null)
    try {
      const bytes = await load()
      const pageSizes = await readNoticePages(bytes)
      // A PDF whose blanks cannot be found is still filled by clicking where text goes.
      let detectionError = null
      const detected = await detectNoticeFields(bytes).catch((detectError) => {
        detectionError = detectError.message
        return []
      })
      setFields(detected)
      setFieldValues({})
      setSource({
        bytes,
        pageSizes,
        saveName: existing ? filledNoticeFileName(name) : name,
        existing,
        detectionError,
      })
      setAdding(detected.length === 0)
    } catch (openError) {
      setError(openError.message)
    } finally {
      setOpening(false)
    }
  }

  const openFile = (file) => open({
    name: file.name,
    existing: false,
    load: async () => {
      if (!file.name.toLowerCase().endsWith('.pdf') || file.size === 0 || file.size > MAX_JOB_DOCUMENT_SIZE) {
        throw new Error('Use a PDF file no larger than 25 MB.')
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
        throw new Error('Use a valid PDF file. Renaming another file to .pdf is not supported.')
      }
      return bytes
    },
  })

  const openExisting = (document) => open({
    name: document.name,
    existing: true,
    load: () => downloadJobDocumentBytes(document),
  })

  const selected = entries.find((entry) => entry.id === selectedId) ?? null
  const allEntries = [...entries, ...buildFieldEntries(fields, fieldValues)]
  const filled = writableEntries(allEntries)
  const problem = describeEntriesProblem(allEntries)
  // A copy of an uploaded notice without any text would only duplicate it.
  const canSave = canManage && !saving && !problem && (!source?.existing || filled.length > 0)
  const dirty = filled.length > 0

  const addEntry = ({ page, x, y, pixelSize, pointsPerPixel }) => {
    const fontSize = lastFontSize.current
    const id = newEntryId()
    const lineHeight = (fontSize * LINE_HEIGHT_EM) / pointsPerPixel / pixelSize.height
    setEntries((current) => [...current, {
      id,
      kind: 'text',
      page,
      x,
      // The click lands in the middle of the line, not at its top.
      y: Math.max(0, y - lineHeight / 2),
      text: '',
      fontSize,
    }])
    setSelectedId(id)
    setFocusId(id)
    setAdding(false)
  }

  const changeEntry = (id, patch) => setEntries((current) => current.map(
    (entry) => (entry.id === id ? { ...entry, ...patch } : entry),
  ))

  const removeEntry = (id) => {
    setEntries((current) => current.filter((entry) => entry.id !== id))
    setSelectedId((current) => (current === id ? null : current))
  }

  const changeFontSize = (delta) => {
    if (!selected) return
    const fontSize = clampFontSize(selected.fontSize + delta)
    lastFontSize.current = fontSize
    changeEntry(selected.id, { fontSize })
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const bytes = await writeNoticeText({ pdfBytes: source.bytes, entries: allEntries })
      const file = new File([bytes], source.saveName, { type: 'application/pdf' })
      await uploadJobDocument({
        jobId: job.id,
        documentType: 'PRELIMINARY_NOTICE',
        file,
      })
      notifyJobDocumentsChanged()
      onSaved?.()
      onClose()
    } catch (saveError) {
      setError(saveError.message)
      setSaving(false)
    }
  }

  const requestClose = () => {
    if (saving) return
    if (dirty) setConfirmingClose(true)
    else onClose()
  }

  return (
    <Dialog open fullScreen onClose={requestClose}>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 1.5, flexWrap: 'wrap' }}>
          <IconButton edge="start" aria-label="Close" onClick={requestClose} disabled={saving}>
            <CloseRoundedIcon />
          </IconButton>
          <Typography fontWeight={850} sx={{ flex: 1, minWidth: 160 }} noWrap>
            Preliminary Notice · Job #{job.code}
            {source ? ` · ${source.saveName}` : ''}
          </Typography>
          {source && (
            <>
              <ToggleButton
                size="small"
                value="add"
                selected={adding}
                disabled={saving}
                onChange={() => setAdding((current) => !current)}
                sx={{ gap: 0.75, textTransform: 'none' }}
              >
                <TextFieldsRoundedIcon fontSize="small" />
                {adding ? 'Click on the page…' : 'Add free text'}
              </ToggleButton>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <IconButton
                  size="small"
                  aria-label="Smaller text"
                  disabled={!selected || selected.fontSize <= MIN_FONT_SIZE}
                  onClick={() => changeFontSize(-1)}
                >
                  <RemoveRoundedIcon fontSize="small" />
                </IconButton>
                <Typography variant="body2" sx={{ minWidth: 44, textAlign: 'center' }}>
                  {selected ? `${selected.fontSize} pt` : '— pt'}
                </Typography>
                <IconButton
                  size="small"
                  aria-label="Larger text"
                  disabled={!selected || selected.fontSize >= MAX_FONT_SIZE}
                  onClick={() => changeFontSize(1)}
                >
                  <AddRoundedIcon fontSize="small" />
                </IconButton>
              </Stack>
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineRoundedIcon />}
                disabled={!selected || saving}
                onClick={() => removeEntry(selected.id)}
              >
                Remove text
              </Button>
              <Button
                variant="contained"
                disableElevation
                startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveRoundedIcon />}
                disabled={!canSave}
                onClick={save}
              >
                {saving ? 'Saving…' : 'Save Preliminary Notice'}
              </Button>
            </>
          )}
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: 'auto', bgcolor: 'action.hover', px: 2, py: 2 }}>
        {error && source && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {problem && source && <Alert severity="warning" sx={{ mb: 2 }}>{problem}</Alert>}
        {!canManage && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Only Admin, Accounting and Project Management can save Job documents.
          </Alert>
        )}
        {!source ? (
          <SourcePicker
            job={job}
            documents={documents}
            loading={loadingDocuments}
            error={error}
            busy={opening}
            onFile={openFile}
            onExisting={openExisting}
          />
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 2 }}>
              {source.existing
                ? 'The filled copy is saved as a new Preliminary Notice; the original stays as it is.'
                : `Saves as ${source.saveName} (${source.pageSizes.length} ${source.pageSizes.length === 1 ? 'page' : 'pages'}).`}
              {' '}
              {fields.length > 0
                ? `${fields.length} fields were found (highlighted): click one and type, or press Tab to go to the next. Click a square to mark it. Use Add free text for anything else.`
                : `No fields were found on this PDF${source.detectionError ? ` (${source.detectionError})` : ''}: press Add free text, click where it goes and type. Drag the handle to move it.`}
            </Typography>
            <PreliminaryNoticePages
              data={source.bytes}
              pageSizes={source.pageSizes}
              entries={entries}
              selectedId={selectedId}
              adding={adding && !saving}
              focusId={focusId}
              fields={fields}
              fieldValues={fieldValues}
              onFieldChange={(id, value) => setFieldValues((current) => ({ ...current, [id]: value }))}
              onSelect={setSelectedId}
              onAdd={addEntry}
              onChange={changeEntry}
              onBlurEmpty={(id) => {
                setEntries((current) => current.filter(
                  (entry) => entry.id !== id || entry.text.trim() !== '',
                ))
              }}
            />
          </>
        )}
      </Box>

      <Dialog open={confirmingClose} onClose={() => setConfirmingClose(false)}>
        <DialogTitle>Discard the text you typed?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The Preliminary Notice has not been saved. Closing now loses the text on its pages.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setConfirmingClose(false)}>Keep editing</Button>
          <Button color="error" onClick={onClose}>Discard</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}
