import { useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import { formatFileSize } from './jobDocumentTypes.js'
import { MAX_JOB_DOCUMENT_SIZE } from '../../services/jobDocumentRecord.js'

function fileSignature(file) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

export default function DocumentUploadDialog({ job, type, uploading, onClose, onAdd }) {
  const fileInputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [rejectedFiles, setRejectedFiles] = useState([])
  const [dragActive, setDragActive] = useState(false)
  const { Icon } = type
  const jobCode = job.code ?? job.id

  const addFiles = (fileList) => {
    const incomingFiles = Array.from(fileList)
    const acceptedFiles = incomingFiles.filter((file) => (
      (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
      && file.size <= MAX_JOB_DOCUMENT_SIZE
      && file.size > 0
    ))
    const invalidFiles = incomingFiles.filter((file) => !acceptedFiles.includes(file))

    setFiles((currentFiles) => {
      const signatures = new Set(currentFiles.map(fileSignature))
      return [
        ...currentFiles,
        ...acceptedFiles.filter((file) => !signatures.has(fileSignature(file))),
      ]
    })
    setRejectedFiles(invalidFiles.map((file) => file.name))
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setDragActive(false)
    addFiles(event.dataTransfer.files)
  }

  const handleInputChange = (event) => {
    addFiles(event.target.files)
    event.target.value = ''
  }

  const handleDropzoneKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      fileInputRef.current?.click()
    }
  }

  return (
    <Dialog open onClose={uploading ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Box
            sx={{
              width: 42,
              height: 42,
              flexShrink: 0,
              borderRadius: 1.5,
              display: 'grid',
              placeItems: 'center',
              bgcolor: `${type.color}.light`,
              color: `${type.color}.dark`,
            }}
          >
            <Icon />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" component="div" fontWeight={850}>
              Upload {type.pluralLabel}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Job #{jobCode} · {job.builder} · {job.community}
            </Typography>
          </Box>
          <IconButton
            onClick={onClose}
            aria-label="Close upload dialog"
            size="small"
            disabled={uploading}
          >
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info" icon={<Icon fontSize="inherit" />}>
            Every file in this batch will be classified as{' '}
            <strong>{type.singularLabel}</strong> for Job #{jobCode}.
          </Alert>

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">
              Document type
            </Typography>
            <Chip
              icon={<Icon />}
              color={type.color}
              label={type.singularLabel}
              size="small"
            />
          </Stack>

          <Box
            role="button"
            tabIndex={0}
            aria-label={`Select ${type.pluralLabel} for Job ${jobCode}`}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={handleDropzoneKeyDown}
            onDragEnter={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            sx={{
              minHeight: 170,
              border: 2,
              borderStyle: 'dashed',
              borderColor: dragActive ? `${type.color}.main` : 'divider',
              borderRadius: 2,
              bgcolor: dragActive ? `${type.color}.light` : 'action.hover',
              display: 'grid',
              placeItems: 'center',
              p: 3,
              textAlign: 'center',
              cursor: 'pointer',
              pointerEvents: uploading ? 'none' : 'auto',
              transition: 'background-color 120ms ease, border-color 120ms ease',
              '&:focus-visible': {
                outline: 2,
                outlineColor: `${type.color}.main`,
                outlineOffset: 2,
              },
            }}
          >
            <Stack spacing={1} sx={{ alignItems: 'center', pointerEvents: 'none' }}>
              <CloudUploadRoundedIcon color={type.color} sx={{ fontSize: 42 }} />
              <Typography fontWeight={850}>
                Drop {type.pluralLabel.toLowerCase()} here
              </Typography>
              <Typography variant="body2" color="text.secondary">
                or click to select one or multiple files
              </Typography>
              <Typography variant="caption" color="text.secondary">
                PDF · Up to 25 MB per file
              </Typography>
            </Stack>
          </Box>

          <Box
            component="input"
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={handleInputChange}
            sx={{ display: 'none' }}
          />

          {rejectedFiles.length > 0 && (
            <Alert severity="warning">
              Only PDF files up to 25 MB can be added. Check: {rejectedFiles.join(', ')}.
            </Alert>
          )}

          {files.length > 0 && (
            <Stack spacing={1}>
              <Typography variant="subtitle2" fontWeight={800}>
                Selected files ({files.length})
              </Typography>
              {files.map((file) => (
                <Box
                  key={fileSignature(file)}
                  sx={{
                    display: 'flex',
                    gap: 1.25,
                    alignItems: 'center',
                    p: 1.25,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1.5,
                  }}
                >
                  <PictureAsPdfRoundedIcon color="error" fontSize="small" />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={750} noWrap title={file.name}>
                      {file.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {type.singularLabel} · {formatFileSize(file.size)}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setFiles((currentFiles) => (
                      currentFiles.filter((candidate) => fileSignature(candidate) !== fileSignature(file))
                    ))}
                  >
                    <DeleteOutlineRoundedIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={uploading}>Cancel</Button>
        <Button
          variant="contained"
          color={type.color}
          startIcon={<CloudUploadRoundedIcon />}
          disabled={files.length === 0 || uploading}
          onClick={() => onAdd(files)}
          disableElevation
        >
          {uploading
            ? 'Uploading…'
            : files.length === 0
            ? 'Add files'
            : `Add ${files.length} ${files.length === 1 ? type.singularLabel : type.pluralLabel}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
