import { useMemo, useRef, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'

import { formatFileSize } from '../../draw-invoice/components/documents/jobDocumentTypes.js'
import { poFileProblem } from '../services/changeOrderPoFileRecord.js'
import { jobChoiceLabel } from '../utils/jobChoices.js'

const fileKey = (file) => `${file.name}-${file.size}-${file.lastModified}`

/**
 * Uploads builder Purchase Order PDFs to one Job. Opened from a Job, the Job is fixed; opened from the
 * top of the page, the Job is chosen first. A PDF that cannot go in (already in the Job, not a PDF) is
 * listed with the reason and the others still go in.
 */
export default function PoUploadDialog({ job: fixedJob = null, jobs = [], onClose, onUpload }) {
  const inputRef = useRef(null)
  const [pickedJob, setPickedJob] = useState(null)
  const [files, setFiles] = useState([])
  const [rejected, setRejected] = useState([])
  const [failed, setFailed] = useState([])
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  // Reading sends the PDF's text to the AI provider (Mistral); it is on by default and can be left for later.
  const [readAfter, setReadAfter] = useState(true)
  const job = fixedJob ?? pickedJob
  const activeJobs = useMemo(() => jobs.filter((candidate) => candidate.isActive !== false), [jobs])

  const addFiles = (list) => {
    const incoming = Array.from(list)
    const problems = incoming
      .map((file) => ({ name: file.name, message: poFileProblem(file) }))
      .filter(({ message }) => message)
    const accepted = incoming.filter((file) => !poFileProblem(file))
    setFiles((current) => {
      const known = new Set(current.map(fileKey))
      return [...current, ...accepted.filter((file) => !known.has(fileKey(file)))]
    })
    setRejected(problems)
    setFailed([])
  }

  const submit = async () => {
    if (!job || files.length === 0) return
    setUploading(true)
    try {
      const result = await onUpload(job, files, readAfter)
      if (result.failed.length === 0) {
        onClose(result)
        return
      }
      // What went in leaves the list; what did not stays with its reason.
      setFiles((current) => current.filter((file) => !result.uploaded.includes(file.name)))
      setFailed(result.failed)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open onClose={uploading ? undefined : () => onClose(null)} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        <Typography variant="h6" component="div" fontWeight={850}>Upload Purchase Orders</Typography>
        <Typography variant="body2" color="text.secondary">
          {fixedJob
            ? `Job ${jobChoiceLabel({ code: fixedJob.jobCode, community: fixedJob.community })} · ${fixedJob.builderName}`
            : 'PDFs the builder sent for the Extras / Change Orders of a Job.'}
        </Typography>
        <IconButton
          aria-label="Close"
          onClick={() => onClose(null)}
          disabled={uploading}
          sx={{ position: 'absolute', right: 12, top: 12 }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          {!fixedJob && (
            <Autocomplete
              options={activeJobs}
              value={pickedJob}
              onChange={(_event, value) => setPickedJob(value)}
              getOptionLabel={(option) => `${jobChoiceLabel(option)}${option.builder ? ` — ${option.builder}` : ''}`}
              isOptionEqualToValue={(option, value) => String(option.id) === String(value.id)}
              disabled={uploading}
              renderInput={(params) => <TextField {...params} label="Job" required autoFocus />}
            />
          )}

          <Box
            role="button"
            tabIndex={0}
            aria-label="Choose PDF files"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragActive(false)
              addFiles(event.dataTransfer.files)
            }}
            sx={{
              border: 2,
              borderStyle: 'dashed',
              borderColor: dragActive ? 'primary.main' : 'divider',
              bgcolor: dragActive ? 'action.hover' : 'transparent',
              borderRadius: 2,
              p: 3,
              textAlign: 'center',
              cursor: 'pointer',
              '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 },
            }}
          >
            <CloudUploadRoundedIcon color="primary" sx={{ fontSize: 36 }} />
            <Typography fontWeight={700}>Drop PDFs here or click to choose</Typography>
            <Typography variant="body2" color="text.secondary">
              Several at once. One PDF can hold several Purchase Orders. Up to 25 MB each.
            </Typography>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={(event) => {
                addFiles(event.target.files)
                event.target.value = ''
              }}
            />
          </Box>

          {rejected.length > 0 && (
            <Alert severity="warning">
              {rejected.map(({ name, message }) => <div key={name}>{name}: {message}</div>)}
            </Alert>
          )}

          {failed.length > 0 && (
            <Alert severity="error">
              These did not go in:
              {failed.map(({ name, message }) => <div key={name}><strong>{name}</strong> — {message}</div>)}
            </Alert>
          )}

          <FormControlLabel
            control={(
              <Checkbox checked={readAfter} onChange={(event) => setReadAfter(event.target.checked)} disabled={uploading} />
            )}
            label={(
              <span>
                Read the orders in them with AI after uploading
                <Typography variant="caption" color="text.secondary" component="div">
                  Finds each PO number, date, Lots and amounts. Every number is checked against the PDF.
                </Typography>
              </span>
            )}
          />

          {files.length > 0 && (
            <List dense disablePadding aria-label="PDFs to upload">
              {files.map((file) => (
                <ListItem
                  key={fileKey(file)}
                  disableGutters
                  secondaryAction={(
                    <IconButton
                      edge="end"
                      aria-label={`Remove ${file.name}`}
                      disabled={uploading}
                      onClick={() => setFiles((current) => current.filter((item) => item !== file))}
                    >
                      <DeleteOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                  )}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <PictureAsPdfRoundedIcon color="error" fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={file.name} secondary={formatFileSize(file.size)} />
                </ListItem>
              ))}
            </List>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onClose(null)} disabled={uploading}>Cancel</Button>
        <Button
          variant="contained"
          disableElevation
          startIcon={<CloudUploadRoundedIcon />}
          onClick={submit}
          disabled={!job || files.length === 0 || uploading}
        >
          {uploading
            ? 'Uploading…'
            : `Upload ${files.length || ''} ${files.length === 1 ? 'PDF' : 'PDFs'}`.replace('  ', ' ')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
