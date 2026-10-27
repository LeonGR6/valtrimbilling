import { useState } from 'react'
import {
  Button,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import MergeTypeRoundedIcon from '@mui/icons-material/MergeTypeRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import MoveToInboxRoundedIcon from '@mui/icons-material/MoveToInboxRounded'

/**
 * The actions of a Package, ranked: the one thing most people come here to do
 * is a filled button, Edit sits beside it, and the rarer or riskier actions
 * (move cells, new Package, delete) wait in the menu. On the worksheet overview,
 * where there is no Package yet, New Package is the filled button.
 */
export default function PackageHeaderActions({
  leading,
  // Opens the Package that was generated, when it was; it renders nothing otherwise.
  viewGenerated = null,
  lockedReason,
  hasPackage,
  canGenerate,
  canEdit,
  canMoveCells,
  canDelete,
  canCreate,
  saving,
  onGenerate,
  onEdit,
  onMoveCells,
  onDelete,
  onCreate,
}) {
  const [anchor, setAnchor] = useState(null)
  const closeMenu = () => setAnchor(null)
  const choose = (action) => () => {
    closeMenu()
    action()
  }

  const showMenu = hasPackage && (canMoveCells || canDelete || canCreate)

  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: { md: 'flex-end' } }}
    >
      {leading}
      {!canEdit && lockedReason && (
        <Tooltip title={lockedReason}>
          <span>
            <Button variant="outlined" color="inherit" startIcon={<LockRoundedIcon />} disabled>
              Edit Package
            </Button>
          </span>
        </Tooltip>
      )}
      {canEdit && (
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<EditRoundedIcon />}
          onClick={onEdit}
          disabled={saving}
        >
          Edit Package
        </Button>
      )}
      {hasPackage && viewGenerated}
      {hasPackage && canGenerate && (
        <Button
          variant="contained"
          disableElevation
          startIcon={<MergeTypeRoundedIcon />}
          onClick={onGenerate}
          disabled={saving}
        >
          Generate package (PDF)
        </Button>
      )}
      {!hasPackage && (
        <Button
          variant="contained"
          disableElevation
          startIcon={<AddRoundedIcon />}
          onClick={onCreate}
          disabled={!canCreate || saving}
        >
          New Package
        </Button>
      )}
      {showMenu && (
        <>
          <Tooltip title="More actions">
            <IconButton
              aria-label="More Package actions"
              aria-haspopup="menu"
              aria-expanded={anchor ? 'true' : undefined}
              onClick={(event) => setAnchor(event.currentTarget)}
              sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}
            >
              <MoreVertRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu}>
            {canMoveCells && (
              <MenuItem onClick={choose(onMoveCells)} disabled={saving}>
                <ListItemIcon><MoveToInboxRoundedIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Move cells here</ListItemText>
              </MenuItem>
            )}
            <MenuItem onClick={choose(onCreate)} disabled={!canCreate || saving}>
              <ListItemIcon><AddRoundedIcon fontSize="small" /></ListItemIcon>
              <ListItemText>New Package</ListItemText>
            </MenuItem>
            {canDelete && <Divider />}
            {canDelete && (
              <MenuItem onClick={choose(onDelete)} disabled={saving} sx={{ color: 'error.main' }}>
                <ListItemIcon sx={{ color: 'inherit' }}>
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Delete draft</ListItemText>
              </MenuItem>
            )}
          </Menu>
        </>
      )}
    </Stack>
  )
}
