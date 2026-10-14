import { useState } from 'react'
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Popover,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import {
  formatLag,
  lagLimit,
  lagPresets,
  lagUnitOptions,
  normalizeLag,
  sameLag,
} from '../utils/drawLag.js'

/**
 * Sets how long after its event a Draw is billed. Only shown for Draws that
 * share their event with another Draw: the button says "Add lag", and once set
 * the chip reads "Billed 1 month after HW" and opens the same picker.
 */
export default function DrawLagControl({ drawNumber, eventType, lag, error, onChange }) {
  const [anchor, setAnchor] = useState(null)
  const [custom, setCustom] = useState({ value: '', unit: 'WEEKS' })
  const current = normalizeLag(lag)
  const customLag = normalizeLag(custom)

  const open = (event) => {
    setCustom(current ?? { value: '', unit: 'WEEKS' })
    setAnchor(event.currentTarget)
  }
  const close = () => setAnchor(null)
  const choose = (next) => {
    onChange(next)
    close()
  }

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
      {current ? (
        <Chip
          size="small"
          color="primary"
          variant="outlined"
          icon={<ScheduleRoundedIcon />}
          label={`Billed ${formatLag(current)} after ${eventType}`}
          onClick={open}
          onDelete={() => onChange(null)}
          aria-label={`Draw ${drawNumber} lag: ${formatLag(current)} after ${eventType}. Change`}
        />
      ) : (
        <Button
          size="small"
          startIcon={<ScheduleRoundedIcon />}
          onClick={open}
          aria-label={`Add a lag to Draw ${drawNumber}`}
        >
          Add lag
        </Button>
      )}
      {!current && (
        <Typography variant="caption" color="text.secondary">
          Billed on the {eventType} date. Another Draw shares this event.
        </Typography>
      )}
      {error && (
        <Typography variant="caption" color="error">{error}</Typography>
      )}

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, width: 320 }}>
          <Typography fontWeight={800}>Draw {drawNumber} lag</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            How long after the {eventType} date this Draw is billed.
          </Typography>

          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
            {lagPresets.map((preset) => {
              const selected = sameLag(current, preset)
              return (
                <Chip
                  key={`${preset.value}-${preset.unit}`}
                  label={formatLag(preset)}
                  clickable
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  onClick={() => choose(preset)}
                />
              )
            })}
          </Stack>

          <Typography variant="body2" fontWeight={700} sx={{ mb: 0.75 }}>Custom</Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              type="number"
              label="Amount"
              value={custom.value}
              onChange={(event) => setCustom((state) => ({ ...state, value: event.target.value }))}
              slotProps={{ htmlInput: { min: 1, max: lagLimit(custom.unit), step: 1 } }}
              sx={{ width: 110 }}
            />
            <TextField
              select
              size="small"
              label="Unit"
              value={custom.unit}
              onChange={(event) => setCustom((state) => ({ ...state, unit: event.target.value }))}
              sx={{ flex: 1 }}
            >
              {lagUnitOptions.map(({ value, label }) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
            </TextField>
          </Stack>
          {custom.value !== '' && !customLag && (
            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
              Use a whole number from 1 to {lagLimit(custom.unit)}.
            </Typography>
          )}

          <Stack direction="row" spacing={1} sx={{ mt: 2, justifyContent: 'space-between' }}>
            <Button
              color="inherit"
              onClick={() => choose(null)}
              disabled={!current}
            >
              Remove lag
            </Button>
            <Button
              variant="contained"
              disableElevation
              disabled={!customLag}
              onClick={() => choose(customLag)}
            >
              Apply
            </Button>
          </Stack>
        </Box>
      </Popover>
    </Stack>
  )
}
