import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import { describeReleaseDocument } from '../../../release-templates/services/releaseTemplateRecord.js'
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
  templatesByDocument = {},
  analyzingDocumentId = null,
  onAdd,
  onDelete,
  onOpen,
  onReviewTemplate,
}) {
  const { Icon } = type
  const supportsTemplates = type.documentType === 'RELEASE' && Boolean(onReviewTemplate)
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
          {documents.map((document) => {
            const template = supportsTemplates ? templatesByDocument[document.id] : null
            const releaseInfo = supportsTemplates ? describeReleaseDocument(template) : null
            const analyzing = analyzingDocumentId === document.id
            const busy = openingDocumentId === document.id
              || deletingDocumentId === document.id

            return (
              <Box
                key={document.id}
                sx={{
                  p: 1.5,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  minWidth: 0,
                }}
              >
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                  <PictureAsPdfRoundedIcon color="error" sx={{ mt: 0.25 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      fontWeight={750}
                      title={document.name}
                      sx={{
                        overflowWrap: 'anywhere',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {document.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatUploadDate(document.createdAt)} · {formatFileSize(document.sizeBytes)}
                    </Typography>
                  </Box>
                </Stack>

                {releaseInfo && (
                  <Stack
                    direction="row"
                    spacing={0.75}
                    useFlexGap
                    sx={{ mt: 1, flexWrap: 'wrap' }}
                  >
                    {releaseInfo.typeChip && (
                      <Tooltip title={releaseInfo.typeChip.title}>
                        <Chip
                          size="small"
                          color="primary"
                          variant="outlined"
                          label={releaseInfo.typeChip.label}
                        />
                      </Tooltip>
                    )}
                    {releaseInfo.status && (
                      <Chip
                        size="small"
                        color={releaseInfo.status.color}
                        variant={releaseInfo.status.color === 'default' ? 'outlined' : 'filled'}
                        label={analyzing ? 'Analyzing…' : releaseInfo.status.label}
                      />
                    )}
                  </Stack>
                )}

                <Stack
                  direction="row"
                  spacing={0.5}
                  useFlexGap
                  sx={{ mt: 1.25, flexWrap: 'wrap' }}
                >
                  {supportsTemplates && (canManage || template) && (
                    <Button
                      size="small"
                      startIcon={analyzing
                        ? <CircularProgress size={16} />
                        : <FactCheckRoundedIcon />}
                      aria-label={`Use ${document.name} as a Release template`}
                      disabled={analyzing || busy}
                      onClick={() => onReviewTemplate(document)}
                    >
                      {template && template.status !== 'failed' ? 'Review' : 'Use as template'}
                    </Button>
                  )}
                  <Button
                    size="small"
                    color="inherit"
                    startIcon={openingDocumentId === document.id
                      ? <CircularProgress size={16} />
                      : <OpenInNewRoundedIcon />}
                    aria-label={`Open ${document.name}`}
                    disabled={busy}
                    onClick={() => onOpen(document)}
                  >
                    Open
                  </Button>
                  {canManage && (
                    <Button
                      size="small"
                      color="error"
                      startIcon={deletingDocumentId === document.id
                        ? <CircularProgress size={16} color="inherit" />
                        : <DeleteOutlineRoundedIcon />}
                      aria-label={`Delete ${document.name}`}
                      disabled={busy}
                      onClick={() => onDelete(document)}
                    >
                      Delete
                    </Button>
                  )}
                </Stack>
              </Box>
            )
          })}

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
