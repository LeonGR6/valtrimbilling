import { useState } from 'react'
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Collapse,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'

const STATUS_COLORS = { ok: 'success', attention: 'warning', missing: 'error', pending: 'info' }

function GroupFrame({ children, dashed = false }) {
  return (
    <Box
      sx={{
        border: 1,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: dashed ? 'text.disabled' : 'divider',
        borderRadius: 1.5,
        mb: 1,
        overflow: 'hidden',
      }}
    >
      {children}
    </Box>
  )
}

function GroupHeader({ label, meta, chip, open, onToggle, controls }) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  return (
    <ButtonBase
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      sx={{
        width: '100%',
        justifyContent: 'flex-start',
        textAlign: 'left',
        gap: 1.25,
        px: 1.5,
        py: 1.1,
        bgcolor: 'action.hover',
        flexWrap: 'wrap',
        '&:hover': { bgcolor: 'action.selected' },
      }}
    >
      <ChevronRightRoundedIcon
        fontSize="small"
        sx={{
          color: 'text.secondary',
          transform: open ? 'rotate(90deg)' : 'none',
          transition: reduceMotion ? 'none' : 'transform 150ms',
        }}
      />
      <Typography fontWeight={650}>{label}</Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          order: { xs: 3, sm: 1 },
          flex: { xs: '1 1 100%', sm: '1 1 0' },
          minWidth: 0,
          pl: { xs: 4, sm: 0 },
          whiteSpace: { xs: 'normal', sm: 'nowrap' },
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {meta}
      </Typography>
      <Box sx={{ order: 2, ml: { xs: 'auto', sm: 0 } }}>{chip}</Box>
    </ButtonBase>
  )
}

/**
 * The files of a section grouped by Phase, each group a collapsible list. Phases with no
 * file yet can be listed too (`groups[].empty`), and files whose Phase could not be told
 * go to a last group that says why. Everything starts collapsed; a file filter opens
 * what matches.
 */
export default function PhaseGroupList({
  idPrefix,
  groups,
  unassigned,
  forceOpen = false,
  renderPlacement,
  renderUnassigned,
  emptyAction = null,
}) {
  const [open, setOpen] = useState({})
  const toggle = (key) => setOpen((current) => ({ ...current, [key]: !current[key] }))
  const isOpen = (key) => forceOpen || Boolean(open[key])

  return (
    <Box>
      {groups.map((group) => {
        if (group.empty) {
          return (
            <GroupFrame key={group.key} dashed>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', px: 1.5, py: 0.75, color: 'text.secondary' }}
              >
                <Typography variant="body2" sx={{ flex: 1 }}>
                  <Typography component="span" variant="body2" fontWeight={650} color="text.primary">
                    {group.label}
                  </Typography>
                  {' '}has no payment schedule yet
                </Typography>
                {emptyAction && (
                  <Button
                    size="small"
                    startIcon={<AddRoundedIcon />}
                    onClick={emptyAction}
                    sx={{ textTransform: 'none' }}
                  >
                    Add
                  </Button>
                )}
              </Stack>
            </GroupFrame>
          )
        }

        const bodyId = `${idPrefix}-${group.key}`
        return (
          <GroupFrame key={group.key}>
            <GroupHeader
              label={group.label}
              meta={group.meta}
              open={isOpen(group.key)}
              onToggle={() => toggle(group.key)}
              controls={bodyId}
              chip={(
                <Chip
                  size="small"
                  color={STATUS_COLORS[group.status] ?? 'default'}
                  variant={group.status === 'ok' ? 'outlined' : 'filled'}
                  label={group.statusLabel}
                />
              )}
            />
            <Collapse in={isOpen(group.key)} unmountOnExit>
              <Box id={bodyId}>
                {group.placements.map((placement) => renderPlacement(placement, group))}
              </Box>
            </Collapse>
          </GroupFrame>
        )
      })}

      {unassigned.length > 0 && (
        <GroupFrame>
          <GroupHeader
            label="Not matched to a phase"
            meta={`${unassigned.length} ${unassigned.length === 1 ? 'file' : 'files'}`}
            open={isOpen('unassigned')}
            onToggle={() => toggle('unassigned')}
            controls={`${idPrefix}-unassigned`}
            chip={<Chip size="small" color="warning" label="Needs a look" />}
          />
          <Collapse in={isOpen('unassigned')} unmountOnExit>
            <Box id={`${idPrefix}-unassigned`}>
              {unassigned.map((item) => renderUnassigned(item))}
            </Box>
          </Collapse>
        </GroupFrame>
      )}
    </Box>
  )
}
