import { useState } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import { formatFileSize } from './jobDocumentTypes.js'

function formatUploadDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Chips of a row: one for what it is, one for where it stands. */
function RowChip({ chip }) {
  const element = (
    <Chip
      size="small"
      color={chip.color ?? 'default'}
      variant={chip.color && chip.color !== 'default' ? 'filled' : 'outlined'}
      label={chip.label}
    />
  )
  return chip.title ? <Tooltip title={chip.title}>{element}</Tooltip> : element
}

/**
 * One file: its name, a line about it, how it stands, one main action, and open /
 * delete as icons (a menu on a phone). The row is a plain line of a list, not a card,
 * so a Job with dozens of files stays readable.
 */
export default function DocumentRow({
  document,
  detail = null,
  note = null,
  chips = [],
  primary = null,
  busyOpening = false,
  busyDeleting = false,
  canDelete = false,
  onOpen,
  onDelete,
}) {
  const compact = useMediaQuery((theme) => theme.breakpoints.down('sm'))
  const [menuAnchor, setMenuAnchor] = useState(null)
  const busy = busyOpening || busyDeleting
  const metaLine = [detail, formatUploadDate(document.createdAt), formatFileSize(document.sizeBytes)]
    .filter(Boolean)
    .join(' · ')

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1,
        py: 1,
        px: 1.5,
        borderTop: 1,
        borderColor: 'divider',
        '&:first-of-type': { borderTop: 0 },
      }}
    >
      <PictureAsPdfRoundedIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
      <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
        <Typography
          variant="body2"
          fontWeight={600}
          noWrap
          title={document.name}
        >
          {document.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
          {metaLine}
          {note ? ` · ${note}` : ''}
        </Typography>
      </Box>

      {document.isComplete === false && (
        <RowChip chip={{ label: 'Incomplete', color: 'warning' }} />
      )}
      {chips.map((chip) => <RowChip key={chip.label} chip={chip} />)}

      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', ml: 'auto' }}>
        {primary && (
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            disabled={primary.disabled || busy}
            aria-label={primary.ariaLabel}
            startIcon={primary.busy ? <CircularProgress size={14} /> : null}
            onClick={primary.onClick}
            sx={{ borderColor: 'divider', textTransform: 'none' }}
          >
            {primary.label}
          </Button>
        )}

        {compact ? (
          <>
            <IconButton
              size="small"
              aria-label={`More actions for ${document.name}`}
              onClick={(event) => setMenuAnchor(event.currentTarget)}
              disabled={busy}
            >
              <MoreVertRoundedIcon fontSize="small" />
            </IconButton>
            <Menu
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={() => setMenuAnchor(null)}
            >
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null)
                  onOpen(document)
                }}
              >
                <ListItemIcon><OpenInNewRoundedIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Open</ListItemText>
              </MenuItem>
              {canDelete && (
                <MenuItem
                  onClick={() => {
                    setMenuAnchor(null)
                    onDelete(document)
                  }}
                  sx={{ color: 'error.main' }}
                >
                  <ListItemIcon sx={{ color: 'inherit' }}>
                    <DeleteOutlineRoundedIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>Delete</ListItemText>
                </MenuItem>
              )}
            </Menu>
          </>
        ) : (
          <>
            <Tooltip title="Open">
              <span>
                <IconButton
                  size="small"
                  aria-label={`Open ${document.name}`}
                  disabled={busy}
                  onClick={() => onOpen(document)}
                >
                  {busyOpening
                    ? <CircularProgress size={16} />
                    : <OpenInNewRoundedIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
            {canDelete && (
              <Tooltip title="Delete">
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    aria-label={`Delete ${document.name}`}
                    disabled={busy}
                    onClick={() => onDelete(document)}
                  >
                    {busyDeleting
                      ? <CircularProgress size={16} color="inherit" />
                      : <DeleteOutlineRoundedIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </>
        )}
      </Stack>
    </Box>
  )
}
