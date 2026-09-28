import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { formatFileSize } from './jobDocumentTypes.js'

function formatUploadDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function DocumentCategoryCard({
  type,
  documents,
  required,
  canManage,
  openingDocumentId,
  deletingDocumentId,
  onAdd,
  onDelete,
  onOpen,
}) {
  const { Icon } = type
  const missingRequiredDocument = required && documents.length === 0

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        borderColor: missingRequiredDocument ? 'warning.main' : 'divider',
      }}
    >
      <CardContent sx={{ p: 2, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: 1.5,
              display: 'grid',
              placeItems: 'center',
              bgcolor: `${type.color}.light`,
              color: `${type.color}.dark`,
            }}
          >
            <Icon fontSize="small" />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Typography fontWeight={850} sx={{ flex: 1 }}>
                {type.pluralLabel}
              </Typography>
              <Chip
                size="small"
                color={type.color}
                variant="outlined"
                label={documents.length}
                aria-label={`${documents.length} ${type.pluralLabel}`}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {type.helperText}
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={0.75} sx={{ mt: 1.25, flexWrap: 'wrap' }}>
          <Chip
            size="small"
            variant={required ? 'filled' : 'outlined'}
            color={required ? 'primary' : 'default'}
            label={required ? 'Required' : 'Optional'}
          />
          {required && (
            <Chip
              size="small"
              color={missingRequiredDocument ? 'warning' : 'success'}
              label={missingRequiredDocument ? 'Missing' : 'Uploaded'}
            />
          )}
        </Stack>

        <Divider sx={{ my: 1.75 }} />

        <Stack spacing={1} sx={{ flex: 1 }}>
          {documents.map((document) => (
            <Box
              key={document.id}
              sx={{
                display: 'flex',
                gap: 1,
                alignItems: 'center',
                p: 1.25,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1.5,
              }}
            >
              <PictureAsPdfRoundedIcon color="error" fontSize="small" />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={750} noWrap title={document.name}>
                  {document.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {type.singularLabel} · {formatUploadDate(document.createdAt)} ·{' '}
                  {formatFileSize(document.sizeBytes)}
                </Typography>
              </Box>
              <Tooltip title="Open PDF">
                <span>
                  <IconButton
                    size="small"
                    aria-label={`Open ${document.name}`}
                    disabled={
                      openingDocumentId === document.id
                      || deletingDocumentId === document.id
                    }
                    onClick={() => onOpen(document)}
                  >
                    {openingDocumentId === document.id
                      ? <CircularProgress size={18} />
                      : <OpenInNewRoundedIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              {canManage && (
                <Tooltip title="Delete PDF">
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={`Delete ${document.name}`}
                      disabled={
                        deletingDocumentId === document.id
                        || openingDocumentId === document.id
                      }
                      onClick={() => onDelete(document)}
                    >
                      {deletingDocumentId === document.id
                        ? <CircularProgress size={18} color="inherit" />
                        : <DeleteOutlineRoundedIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Box>
          ))}

          {documents.length === 0 && (
            <Box
              sx={{
                minHeight: 74,
                border: 1,
                borderStyle: 'dashed',
                borderColor: missingRequiredDocument ? 'warning.main' : 'divider',
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                px: 2,
                textAlign: 'center',
                bgcolor: missingRequiredDocument ? 'warning.light' : 'transparent',
              }}
            >
              <Box>
                <Typography
                  variant="body2"
                  fontWeight={missingRequiredDocument ? 800 : 400}
                  color={missingRequiredDocument ? 'warning.dark' : 'text.secondary'}
                >
                  {missingRequiredDocument ? 'Required document missing' : type.emptyLabel}
                </Typography>
                {missingRequiredDocument && (
                  <Typography variant="caption" color="warning.dark">
                    Upload at least one PDF to complete this requirement.
                  </Typography>
                )}
              </Box>
            </Box>
          )}
        </Stack>

        <Button
          fullWidth
          variant="outlined"
          color={type.color}
          startIcon={<AddRoundedIcon />}
          onClick={onAdd}
          disabled={!canManage}
          sx={{ mt: 1.75 }}
        >
          {type.addLabel}
        </Button>
      </CardContent>
    </Card>
  )
}
