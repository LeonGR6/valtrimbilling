import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  InputAdornment,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { useBuilders } from '../../builders/context/useBuilders.js'
import {
  defaultBuilderDateConfiguration,
  getBuilderDateConfiguration,
} from '../../builders/data/builders.js'

function createDrafts(builders) {
  return Object.fromEntries(builders.map((builder) => [
    builder.id,
    getBuilderDateConfiguration(builder),
  ]))
}

function parseWeeks(value, minimum = 0) {
  if (value === '') return null
  const weeks = Number(value)
  return Number.isInteger(weeks) && weeks >= minimum && weeks <= 52 ? weeks : null
}

function isDefaultConfiguration(configuration) {
  return Number(configuration.extToDmWeeks) === defaultBuilderDateConfiguration.extToDmWeeks
    && Number(configuration.shutterBeforeDmWeeks) === defaultBuilderDateConfiguration.shutterBeforeDmWeeks
    && Number(configuration.dmToHwWeeks) === defaultBuilderDateConfiguration.dmToHwWeeks
}

function StageBadge({ label, tone }) {
  return <span className={`builder-date-stage activity-tone--${tone}`}>{label}</span>
}

export default function BuilderDateSettings() {
  const { builders, updateBuilderDateConfiguration } = useBuilders()
  const [drafts, setDrafts] = useState(() => createDrafts(builders))
  const [notice, setNotice] = useState('')

  const changeDraft = (builderId, field, value) => {
    setDrafts((current) => ({
      ...current,
      [builderId]: {
        ...getBuilderDateConfiguration(builders.find((builder) => builder.id === builderId)),
        ...current[builderId],
        [field]: value,
      },
    }))
  }

  const saveConfiguration = (builder) => {
    const draft = drafts[builder.id] ?? getBuilderDateConfiguration(builder)
    const extToDmWeeks = parseWeeks(draft.extToDmWeeks)
    const shutterBeforeDmWeeks = parseWeeks(draft.shutterBeforeDmWeeks, 1)
    const dmToHwWeeks = parseWeeks(draft.dmToHwWeeks)
    if (extToDmWeeks == null || shutterBeforeDmWeeks == null || dmToHwWeeks == null) return

    const configuration = { extToDmWeeks, shutterBeforeDmWeeks, dmToHwWeeks }
    updateBuilderDateConfiguration(builder.id, configuration)
    setDrafts((current) => ({ ...current, [builder.id]: configuration }))
    setNotice(`${builder.name} date configuration saved.`)
  }

  const resetConfiguration = (builder) => {
    const configuration = { ...defaultBuilderDateConfiguration }
    updateBuilderDateConfiguration(builder.id, configuration)
    setDrafts((current) => ({ ...current, [builder.id]: configuration }))
    setNotice(`${builder.name} restored to the default spacing.`)
  }

  return (
    <Box className="builder-date-settings">
      <Box className="builder-date-settings__intro">
        <Box>
          <Typography variant="h5" fontWeight={780}>Builder date configuration</Typography>
          <Typography variant="body2" color="text.secondary">
            Set the automatic spacing between EXT, Shutter, DM and HW for each builder.
          </Typography>
        </Box>
        <Chip
          icon={<CalendarMonthRoundedIcon />}
          label="Default: DM 4 weeks after EXT · Shutter 1 week before DM · HW 1 week after DM"
          color="primary"
          variant="outlined"
        />
      </Box>

      <Alert severity="info">
        The seven configured U.S. holidays and their observed weekdays are excluded from the week count.
        Moving DM recalculates Shutter when the Shutter option is enabled on that DM event.
      </Alert>

      <Box className="builder-date-settings__grid">
        {builders.map((builder) => {
          const draft = drafts[builder.id] ?? getBuilderDateConfiguration(builder)
          const extToDmValid = parseWeeks(draft.extToDmWeeks) != null
          const shutterBeforeDmValid = parseWeeks(draft.shutterBeforeDmWeeks, 1) != null
          const dmToHwValid = parseWeeks(draft.dmToHwWeeks) != null

          return (
            <Paper key={builder.id} variant="outlined" className="builder-date-rule-card">
              <Box className="builder-date-rule-card__header">
                <Box className="builder-date-rule-card__identity">
                  <Box className="builder-date-rule-card__icon"><BusinessRoundedIcon /></Box>
                  <Box>
                    <Typography variant="subtitle1" fontWeight={780}>{builder.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{builder.code}</Typography>
                  </Box>
                </Box>
                <Stack direction="row" spacing={0.75}>
                  {!builder.isActive && <Chip size="small" label="Inactive" variant="outlined" />}
                  <Chip
                    size="small"
                    label={isDefaultConfiguration(draft) ? 'Default' : 'Custom'}
                    color={isDefaultConfiguration(draft) ? 'default' : 'primary'}
                    variant="outlined"
                  />
                </Stack>
              </Box>

              <Box className="builder-date-rule-card__flow">
                <StageBadge label="EXT" tone="ext" />
                <ArrowForwardRoundedIcon color="action" />
                <TextField
                  label="EXT to DM"
                  aria-label={`${builder.name} EXT to DM weeks`}
                  type="number"
                  value={draft.extToDmWeeks}
                  onChange={(event) => changeDraft(builder.id, 'extToDmWeeks', event.target.value)}
                  error={!extToDmValid}
                  helperText={extToDmValid ? 'Weeks' : 'Use 0–52 whole weeks.'}
                  size="small"
                  slotProps={{
                    htmlInput: { min: 0, max: 52, step: 1 },
                    input: { endAdornment: <InputAdornment position="end">wk</InputAdornment> },
                  }}
                />
                <ArrowForwardRoundedIcon color="action" />
                <StageBadge label="DM" tone="dm" />
                <ArrowForwardRoundedIcon color="action" />
                <TextField
                  label="DM to HW"
                  aria-label={`${builder.name} DM to HW weeks`}
                  type="number"
                  value={draft.dmToHwWeeks}
                  onChange={(event) => changeDraft(builder.id, 'dmToHwWeeks', event.target.value)}
                  error={!dmToHwValid}
                  helperText={dmToHwValid ? 'Weeks' : 'Use 0–52 whole weeks.'}
                  size="small"
                  slotProps={{
                    htmlInput: { min: 0, max: 52, step: 1 },
                    input: { endAdornment: <InputAdornment position="end">wk</InputAdornment> },
                  }}
                />
                <ArrowForwardRoundedIcon color="action" />
                <StageBadge label="HW" tone="hw" />
              </Box>

              <Box className="builder-date-rule-card__shutter activity-tone--shutter">
                <StageBadge label="SHUTTER" tone="shutter" />
                <Box className="builder-date-rule-card__shutter-copy">
                  <Typography variant="subtitle2" fontWeight={750}>Shutter timing</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Used when the Shutter checkbox is enabled on a DM event.
                  </Typography>
                </Box>
                <TextField
                  label="Before DM"
                  aria-label={`${builder.name} Shutter weeks before DM`}
                  type="number"
                  value={draft.shutterBeforeDmWeeks}
                  onChange={(event) => changeDraft(builder.id, 'shutterBeforeDmWeeks', event.target.value)}
                  error={!shutterBeforeDmValid}
                  helperText={shutterBeforeDmValid ? 'Weeks before DM' : 'Use 1–52 whole weeks.'}
                  size="small"
                  slotProps={{
                    htmlInput: { min: 1, max: 52, step: 1 },
                    input: { endAdornment: <InputAdornment position="end">wk</InputAdornment> },
                  }}
                />
              </Box>

              <Box className="builder-date-rule-card__actions">
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<RestartAltRoundedIcon />}
                  onClick={() => resetConfiguration(builder)}
                >
                  Reset default
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<SaveRoundedIcon />}
                  onClick={() => saveConfiguration(builder)}
                  disabled={!extToDmValid || !shutterBeforeDmValid || !dmToHwValid}
                  disableElevation
                >
                  Save
                </Button>
              </Box>
            </Paper>
          )
        })}
      </Box>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3000}
        onClose={() => setNotice('')}
        message={notice}
      />
    </Box>
  )
}
