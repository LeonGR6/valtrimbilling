import { useEffect, useMemo, useRef, useState } from 'react'
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
  Stack,
  ToggleButton,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded'
import { notifyJobDocumentsChanged } from '../../services/jobDocumentEvents.js'
import { uploadJobDocument } from '../../services/jobDocumentsRepository.js'
import {
  DEFAULT_FONT_SIZE,
  buildFieldEntries,
  LINE_HEIGHT_EM,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  clampFontSize,
  describeEntriesProblem,
  readNoticePages,
  writeNoticeText,
} from '../../services/preliminaryNoticePdf.js'
import { printPdfBytes } from '../../services/printPdf.js'
import {
  applyFieldValue,
  fieldValuesChanged,
  initialFieldValues,
  linkedFieldIds,
  missingRequiredFields,
} from '../../services/preliminaryNoticeRules.js'
import {
  loadNoticeTemplate,
  noticeFileNameForJob,
} from '../../services/preliminaryNoticeTemplate.js'
import { detectNoticeFields } from '../../services/preliminaryNoticeFieldsLoader.js'
import PreliminaryNoticePages from './PreliminaryNoticePages.jsx'

let entryCounter = 0
const newEntryId = () => {
  entryCounter += 1
  return `entry-${entryCounter}`
}

/**
 * Fills in a Job's Preliminary Notice. The form is the California notice that
 * ships with the app: it opens blank for the Job, with its usual boxes already
 * marked, and the filled copy is saved as the Job's Preliminary Notice. Text
 * can also be placed anywhere on the pages like in a simple PDF editor.
 */
export default function PreliminaryNoticeEditorDialog({ job, canManage = true, onClose, onSaved }) {
  const [source, setSource] = useState(null)
  const [opening, setOpening] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [entries, setEntries] = useState([])
  // The blanks and check boxes found on the PDF, and what was typed in them.
  const [fields, setFields] = useState([])
  const [fieldValues, setFieldValues] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [focusId, setFocusId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const lastFontSize = useRef(DEFAULT_FONT_SIZE)

  // The form opens by itself: there is nothing to upload.
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const bytes = await loadNoticeTemplate()
        const pageSizes = await readNoticePages(bytes)
        // If the blanks cannot be found, the form is still filled by clicking
        // where text goes.
        let detectionError = null
        const detected = await detectNoticeFields(bytes).catch((detectError) => {
          detectionError = detectError.message
          return []
        })
        if (cancelled) return

        setFields(detected)
        setFieldValues(initialFieldValues(detected))
        setSource({
          bytes,
          pageSizes,
          saveName: noticeFileNameForJob(job),
          detectionError,
        })
        setAdding(detected.length === 0)
        setError(null)
      } catch (openError) {
        if (!cancelled) setError(openError.message)
      } finally {
        if (!cancelled) setOpening(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [job, loadAttempt])

  const retryLoad = () => {
    setOpening(true)
    setError(null)
    setLoadAttempt((attempt) => attempt + 1)
  }

  const selected = entries.find((entry) => entry.id === selectedId) ?? null
  const allEntries = [...entries, ...buildFieldEntries(fields, fieldValues)]
  const problem = describeEntriesProblem(allEntries)
  const canSave = canManage && !saving && !problem
  const links = useMemo(() => linkedFieldIds(fields), [fields])
  const startingValues = useMemo(() => initialFieldValues(fields), [fields])
  // The boxes that start marked do not count as something typed.
  const dirty = entries.some((entry) => entry.text.trim() !== '')
    || fieldValuesChanged(fieldValues, startingValues)
  const missingFields = missingRequiredFields(fields, fieldValues)
  const missingFieldIds = new Set(missingFields.map(({ id }) => id))
  const canPrint = Boolean(source) && !saving && !printing && !problem && missingFields.length === 0

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

  const print = async () => {
    setPrinting(true)
    setError(null)
    try {
      const bytes = await writeNoticeText({ pdfBytes: source.bytes, entries: allEntries })
      await printPdfBytes(bytes)
    } catch (printError) {
      setError(printError.message)
    } finally {
      setPrinting(false)
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
              <Tooltip
                title={missingFields.length > 0
                  ? `Fill in the ${missingFields.length} highlighted ${missingFields.length === 1 ? 'blank' : 'blanks'} to print. The signature, the current demand, the attachments, the personal delivery lines and the second address lines are optional.`
                  : 'Print the Preliminary Notice as it is filled in'}
              >
                <span>
                  <Button
                    variant="outlined"
                    startIcon={printing ? <CircularProgress size={18} color="inherit" /> : <PrintRoundedIcon />}
                    disabled={!canPrint}
                    onClick={print}
                  >
                    {missingFields.length > 0 ? `Print (${missingFields.length} to fill)` : 'Print'}
                  </Button>
                </span>
              </Tooltip>
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
          <Stack spacing={2} sx={{ maxWidth: 480, mx: 'auto', py: 8, alignItems: 'center' }}>
            {opening ? (
              <>
                <CircularProgress />
                <Typography color="text.secondary">Opening the Preliminary Notice…</Typography>
              </>
            ) : (
              <>
                <Alert severity="error" sx={{ width: '100%' }}>
                  {error ?? 'The Preliminary Notice could not be opened.'}
                </Alert>
                <Button variant="outlined" onClick={retryLoad}>Try again</Button>
              </>
            )}
          </Stack>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 2 }}>
              {`Saves as ${source.saveName}.`}
              {' '}
              {fields.length > 0
                ? `${fields.length} fields (highlighted): click one and type, or press Tab to go to the next. Click a square to mark it. The Owner, Direct Contractor, Construction lender, Mail / carrier service and Certified boxes start marked. The Direct Contractor and the person the work is provided for share their name and address, and so do the declaration name and the printed name. Orange blanks are still needed to print. Use Add free text for anything else.`
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
              missingFieldIds={missingFieldIds}
              onFieldChange={(id, value) => setFieldValues(
                (current) => applyFieldValue(current, links, id, value),
              )}
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
