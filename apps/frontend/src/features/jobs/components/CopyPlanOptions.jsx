import { useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  NO_COPY_SOURCE,
  copyableOptions,
  emptyCopySelection,
  selectedCopyOptions,
} from '../services/planOptionCopy.js'

const NONE = NO_COPY_SOURCE

function planLabel(plan) {
  const count = plan.options?.length ?? 0
  const showsName = plan.name && plan.name !== plan.code && plan.name !== `Plan ${plan.code}`
  return `Plan ${plan.code}${showsName ? ` · ${plan.name}` : ''} (${count} ${count === 1 ? 'option' : 'options'})`
}

/**
 * Picks a Plan of the Job and some or all of its Options. Controlled: `value` is
 * `{ sourceId, selectedIds }`. `target` is the Plan the Options are going into
 * (null while it is still being created); Options it already has are shown
 * but cannot be picked again.
 */
export function CopyOptionsPicker({ sources, target = null, value, onChange, disabled = false }) {
  const source = sources.find(({ id }) => id === value.sourceId) ?? null
  const rows = copyableOptions(source, target)
  const selectable = rows.filter(({ alreadyInTarget }) => !alreadyInTarget)
  const selectedCount = selectable.filter(({ option }) => value.selectedIds.has(option.id)).length
  const allSelected = selectable.length > 0 && selectedCount === selectable.length

  const chooseSource = (event) => {
    const next = sources.find(({ id }) => String(id) === event.target.value) ?? null
    onChange({
      sourceId: next?.id ?? NONE,
      // Everything is picked to begin with: the usual case is "the same ones".
      selectedIds: new Set(
        copyableOptions(next, target)
          .filter(({ alreadyInTarget }) => !alreadyInTarget)
          .map(({ option }) => option.id),
      ),
    })
  }

  const toggle = (id) => {
    const next = new Set(value.selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ ...value, selectedIds: next })
  }

  const toggleAll = () => {
    onChange({
      ...value,
      selectedIds: allSelected
        ? new Set()
        : new Set(selectable.map(({ option }) => option.id)),
    })
  }

  return (
    <Stack spacing={1.25}>
      <TextField
        select
        size="small"
        label="Copy options from"
        value={value.sourceId === NONE ? NONE : String(value.sourceId)}
        onChange={chooseSource}
        disabled={disabled}
        fullWidth
      >
        <MenuItem value={NONE}>Don’t copy any options</MenuItem>
        {sources.map((plan) => (
          <MenuItem key={plan.id} value={String(plan.id)}>{planLabel(plan)}</MenuItem>
        ))}
      </TextField>

      {source && (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              px: 1.5,
              py: 0.5,
              alignItems: 'center',
              justifyContent: 'space-between',
              bgcolor: 'action.hover',
            }}
          >
            <FormControlLabel
              disabled={disabled || selectable.length === 0}
              label={`Select all (${selectable.length})`}
              control={(
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={selectedCount > 0 && !allSelected}
                  onChange={toggleAll}
                />
              )}
            />
            <Typography variant="caption" color="text.secondary">
              {selectedCount} selected
            </Typography>
          </Stack>

          <Box sx={{ maxHeight: 280, overflowY: 'auto' }}>
            {rows.map(({ option, alreadyInTarget }) => (
              <FormControlLabel
                key={option.id}
                disabled={disabled || alreadyInTarget}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  m: 0,
                  px: 1.5,
                  py: 0.5,
                  borderTop: 1,
                  borderColor: 'divider',
                }}
                control={(
                  <Checkbox
                    size="small"
                    checked={!alreadyInTarget && value.selectedIds.has(option.id)}
                    onChange={() => toggle(option.id)}
                  />
                )}
                label={(
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap', pt: 0.75 }} useFlexGap>
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={option.code}
                      sx={{ fontWeight: 700 }}
                    />
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      {option.description}
                    </Typography>
                    {alreadyInTarget && (
                      <Typography variant="caption" color="text.secondary">
                        Already in this plan
                      </Typography>
                    )}
                  </Stack>
                )}
              />
            ))}
          </Box>
        </Box>
      )}
    </Stack>
  )
}

/** Copies Options from another Plan into an existing one. */
export function CopyOptionsDialog({ plan, sources, onClose, onCopy, submitting }) {
  const [value, setValue] = useState(emptyCopySelection)
  const options = selectedCopyOptions(sources, value, plan)

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={750}>
          Copy options into Plan {plan.code}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Pick the plan that has them and choose which ones to add. Prices are
          not copied; set them in Plan pricing.
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <CopyOptionsPicker
          sources={sources}
          target={plan}
          value={value}
          onChange={setValue}
          disabled={submitting}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button
          variant="contained"
          disableElevation
          disabled={submitting || options.length === 0}
          onClick={() => onCopy(options)}
        >
          {submitting
            ? 'Copying...'
            : options.length === 0
              ? 'Copy options'
              : `Copy ${options.length} ${options.length === 1 ? 'option' : 'options'}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
