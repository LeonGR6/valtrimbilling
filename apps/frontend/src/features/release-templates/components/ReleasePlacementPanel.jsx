import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddLocationAltRoundedIcon from '@mui/icons-material/AddLocationAltRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import {
  bestSuggestion,
  describeClassification,
  describeSuggestion,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  RELEASE_TYPES,
  RELEASE_VARIABLES,
} from '../services/releaseTemplateRecord.js'

function ClassificationSummary({ template }) {
  const summary = describeClassification(template)

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Chip
          size="small"
          color={summary.needsAttention ? 'warning' : 'success'}
          label={template.releaseType ? `Detected · ${summary.percent}` : 'Not recognised'}
        />
        <Chip size="small" variant="outlined" label={`From ${summary.methodLabel}`} />
      </Stack>
      {summary.evidence && (
        <Typography variant="caption" color="text.secondary">
          Title found: {summary.evidence}
        </Typography>
      )}
      {summary.needsAttention && (
        <Alert severity="warning" sx={{ py: 0 }}>
          {template.releaseType
            ? 'The type is not certain. Check it against the title of the form before confirming.'
            : 'The type could not be recognised. Select it before confirming.'}
        </Alert>
      )}
    </Stack>
  )
}

function FieldRow({
  variable,
  template,
  placement,
  selected,
  readOnly,
  onSelect,
  onPlace,
  onRemove,
  onUpdate,
}) {
  const suggestion = bestSuggestion(template, variable.key)

  return (
    <Box
      onMouseDown={() => placement && onSelect(variable.key)}
      sx={{
        p: 1.5,
        border: 1,
        borderColor: selected ? 'primary.main' : 'divider',
        borderRadius: 1.5,
        bgcolor: selected ? 'action.hover' : 'transparent',
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography fontWeight={800} sx={{ flex: 1 }}>{variable.label}</Typography>
        <Chip
          size="small"
          color={placement ? 'success' : 'default'}
          variant={placement ? 'filled' : 'outlined'}
          label={placement
            ? (placement.kind === 'rect' ? `Page ${placement.page}` : 'Form field')
            : 'Not placed'}
        />
      </Stack>

      {!placement && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {describeSuggestion(suggestion)}
        </Typography>
      )}

      {!placement && !readOnly && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddLocationAltRoundedIcon />}
          onClick={() => onPlace(variable.key)}
          sx={{ mt: 1 }}
        >
          Place box
        </Button>
      )}

      {placement && (
        <Stack spacing={1.25} sx={{ mt: 1.25 }}>
          {placement.kind === 'acroform' && (
            <Typography variant="caption" color="text.secondary">
              Linked to the form field “{placement.fieldName}”.
            </Typography>
          )}
          <Stack direction="row" spacing={1}>
            {placement.kind === 'rect' && template.pageCount > 1 && (
              <TextField
                select
                size="small"
                label="Page"
                value={placement.page}
                disabled={readOnly}
                onChange={(event) => onUpdate(variable.key, { page: Number(event.target.value) })}
                sx={{ width: 90 }}
              >
                {Array.from({ length: template.pageCount }, (_, index) => (
                  <MenuItem key={index + 1} value={index + 1}>{index + 1}</MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              size="small"
              type="number"
              label="Font size"
              value={placement.fontSize}
              disabled={readOnly}
              onChange={(event) => onUpdate(variable.key, { fontSize: event.target.value })}
              slotProps={{
                htmlInput: { min: MIN_FONT_SIZE, max: MAX_FONT_SIZE, step: 0.5 },
              }}
              sx={{ width: 110 }}
            />
            <TextField
              select
              size="small"
              label="Format"
              value={placement.format}
              disabled={readOnly}
              onChange={(event) => onUpdate(variable.key, { format: event.target.value })}
              sx={{ flex: 1, minWidth: 0 }}
            >
              {variable.formats.map((format) => (
                <MenuItem key={format.value} value={format.value}>{format.label}</MenuItem>
              ))}
            </TextField>
          </Stack>
          <FormControlLabel
            disableTypography
            sx={{ m: 0, typography: 'caption', color: 'text.secondary' }}
            control={(
              <Checkbox
                size="small"
                checked={placement.cover}
                disabled={readOnly}
                onChange={(event) => onUpdate(variable.key, { cover: event.target.checked })}
              />
            )}
            label="Cover text already printed in this area"
          />
          {!readOnly && (
            <Button
              size="small"
              color="error"
              startIcon={<DeleteOutlineRoundedIcon />}
              onClick={() => onRemove(variable.key)}
              sx={{ alignSelf: 'flex-start' }}
            >
              Remove box
            </Button>
          )}
        </Stack>
      )}
    </Box>
  )
}

export default function ReleasePlacementPanel({
  template,
  releaseType,
  placements,
  selectedVariable,
  validation,
  readOnly,
  onReleaseTypeChange,
  onSelect,
  onPlace,
  onRemove,
  onUpdate,
}) {
  const placementFor = (key) => placements.find((placement) => placement.variable === key) ?? null

  return (
    <Stack spacing={2.25}>
      <Box>
        <Typography variant="subtitle2" fontWeight={850} sx={{ mb: 1 }}>
          1. Release type
        </Typography>
        <TextField
          select
          fullWidth
          size="small"
          label="Release type"
          value={releaseType}
          disabled={readOnly}
          error={!releaseType}
          onChange={(event) => onReleaseTypeChange(event.target.value)}
        >
          {RELEASE_TYPES.map((type) => (
            <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>
          ))}
        </TextField>
        <Box sx={{ mt: 1.25 }}>
          <ClassificationSummary template={template} />
        </Box>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" fontWeight={850}>
          2. Where each value goes
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
          Drag and resize each box over the blank area of the form. The text inside shows how the value will look.
        </Typography>
        <Stack spacing={1.25}>
          {RELEASE_VARIABLES.map((variable) => (
            <FieldRow
              key={variable.key}
              variable={variable}
              template={template}
              placement={placementFor(variable.key)}
              selected={selectedVariable === variable.key}
              readOnly={readOnly}
              onSelect={onSelect}
              onPlace={onPlace}
              onRemove={onRemove}
              onUpdate={onUpdate}
            />
          ))}
        </Stack>
      </Box>

      {placements.length === 0 && (
        <Alert severity="info">Place at least one box to confirm the template.</Alert>
      )}
      {placements.length > 0 && !validation.success && (
        <Alert severity="error">
          <Stack component="ul" sx={{ m: 0, pl: 2 }}>
            {validation.errors.map((message) => <li key={message}>{message}</li>)}
          </Stack>
        </Alert>
      )}
    </Stack>
  )
}
