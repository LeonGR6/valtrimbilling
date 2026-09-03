import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { activityTypeMap, dateOwnerOptions } from '../data/calendarEvents.js'
import { addSplitDivision, removeSplitDivision } from './calendarSchedulerUtils.js'

export function OptionCheckbox({ checked, disabled = false, label, description, onChange, endAdornment = null }) {
  return (
    <FormControlLabel
      disabled={disabled}
      control={<Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />}
      label={(
        <Box className="activity-option-label">
          <Box>
            <Typography variant="body2" fontWeight={700}>{label}</Typography>
            <Typography variant="caption" color="text.secondary">{description}</Typography>
          </Box>
          {endAdornment}
        </Box>
      )}
    />
  )
}

export function DateOwnerSelector({ value, onChange, label = 'Date ownership', compact = false }) {
  return (
    <Box
      className={`date-owner-selector${compact ? ' date-owner-selector--compact' : ''}`}
      role="group"
      aria-label={label}
    >
      <Typography variant="caption" color="text.secondary" fontWeight={750}>{label}</Typography>
      <Box className="date-owner-selector__choices">
        {dateOwnerOptions.map((option) => (
          <FormControlLabel
            key={option.value}
            className={`date-owner-choice${value === option.value ? ' is-selected' : ''}`}
            control={(
              <Checkbox
                checked={value === option.value}
                onChange={(event) => onChange(event.target.checked ? option.value : '')}
                size="small"
                slotProps={{ input: { 'aria-label': option.label } }}
              />
            )}
            label={option.label}
          />
        ))}
      </Box>
      {!value && (
        <Typography variant="caption" color="text.secondary">
          No selection will be saved as Tentative Date.
        </Typography>
      )}
    </Box>
  )
}

export function SplitScheduleEditor({ activityType, parts, totalLots, onChange, onReset }) {
  const type = activityTypeMap[activityType]
  const canAddDivision = parts.length < totalLots

  return (
    <Box className="stage-split-editor">
      <Box className="activity-form__heading activity-form__heading--actions">
        <Box>
          <Typography variant="subtitle2" fontWeight={800}>Split schedule</Typography>
          <Typography variant="caption" color="text.secondary">Each division becomes an all-day calendar event.</Typography>
        </Box>
        <Stack direction="row" spacing={0.5}>
          <Button size="small" onClick={onReset}>Reset</Button>
          <Button
            size="small"
            startIcon={<AddRoundedIcon />}
            disabled={!canAddDivision}
            onClick={() => onChange(addSplitDivision(parts))}
          >
            Division
          </Button>
        </Stack>
      </Box>
      <Stack spacing={1}>
        {parts.map((part, index) => (
          <Paper key={part.id} variant="outlined" className={`split-part activity-tone--${type.tone}`}>
            <Box className="split-part__heading">
              <Typography variant="caption" fontWeight={800}>DIVISION {index + 1}</Typography>
              <IconButton
                size="small"
                aria-label={`Remove division ${index + 1}`}
                disabled={parts.length <= 2}
                onClick={() => onChange(removeSplitDivision(parts, index))}
              >
                <DeleteOutlineRoundedIcon fontSize="small" />
              </IconButton>
            </Box>
            <Box className="split-part__fields">
              <TextField
                label="From"
                type="number"
                value={part.lotStart}
                onChange={(event) => onChange(parts.map((item) => item.id === part.id
                  ? { ...item, lotStart: event.target.value }
                  : item))}
                slotProps={{ htmlInput: { min: 1 } }}
                required
              />
              <TextField
                label="To"
                type="number"
                value={part.lotEnd}
                onChange={(event) => onChange(parts.map((item) => item.id === part.id
                  ? { ...item, lotEnd: event.target.value }
                  : item))}
                slotProps={{ htmlInput: { min: 1 } }}
                required
              />
              <TextField
                label="Date"
                type="date"
                value={part.date}
                onChange={(event) => onChange(parts.map((item) => item.id === part.id
                  ? { ...item, date: event.target.value }
                  : item))}
                slotProps={{ inputLabel: { shrink: true } }}
                required
              />
            </Box>
            <DateOwnerSelector
              value={part.dateOwner}
              onChange={(dateOwner) => onChange(parts.map((item) => item.id === part.id
                ? { ...item, dateOwner }
                : item))}
              label={`${type.shortLabel} division ${index + 1} date ownership`}
              compact
            />
            <TextField
              label="Date note (optional)"
              value={part.note ?? ''}
              onChange={(event) => onChange(parts.map((item) => item.id === part.id
                ? { ...item, note: event.target.value }
                : item))}
              slotProps={{ htmlInput: { maxLength: 100 } }}
              helperText={`${(part.note ?? '').length}/100`}
              multiline
              minRows={2}
              fullWidth
              size="small"
              className="date-note-field"
            />
          </Paper>
        ))}
      </Stack>
    </Box>
  )
}

export function StageCard({
  activityType,
  date,
  dateOwner,
  note,
  onDateChange,
  onDateOwnerChange,
  onNoteChange,
  tone,
  children,
}) {
  const type = activityTypeMap[activityType]

  return (
    <Paper variant="outlined" className={`production-stage-card activity-tone--${tone}`}>
      <Box className="production-stage-card__header">
        <Box className="production-stage-card__identity">
          <span className="production-stage-card__number">{activityType}</span>
          <Box>
            <Typography variant="subtitle1" fontWeight={800}>{type.label}</Typography>
            <Typography variant="caption" color="text.secondary">{type.description}</Typography>
          </Box>
        </Box>
        <TextField
          label={`${activityType} date`}
          type="date"
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          required
          size="small"
          className="production-stage-card__date"
        />
      </Box>
      <DateOwnerSelector
        value={dateOwner}
        onChange={onDateOwnerChange}
        label={`${activityType} date ownership`}
      />
      <Box className="production-stage-card__note">
        <TextField
          label={`${activityType} date note (optional)`}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 100 } }}
          helperText={`${note.length}/100`}
          multiline
          minRows={2}
          fullWidth
          size="small"
        />
      </Box>
      {children}
    </Paper>
  )
}
