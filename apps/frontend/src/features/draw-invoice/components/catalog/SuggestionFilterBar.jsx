import {
  Box,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { submissionMethodLabels } from '../../../builder-draw-schedules/data/builderDrawSchedules.js'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'

/** The fields at the top of a suggestions card. */
export default function SuggestionFilterBar({ filter, label }) {
  if (!filter.visible) return null

  return (
    <Box
      sx={{
        px: { xs: 1.5, md: 2 },
        py: 1,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ alignItems: { sm: 'center' } }}>
        <TextField
          select
          size="small"
          label="Builder"
          value={filter.builder}
          onChange={(event) => filter.setBuilder(event.target.value)}
          sx={{ minWidth: { sm: 220 } }}
          slotProps={{ htmlInput: { 'aria-label': `Filter ${label} by Builder` } }}
        >
          <MenuItem value="">All Builders</MenuItem>
          {filter.builders.map((name) => (
            <MenuItem key={name} value={name}>{name}</MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Job"
          placeholder="Job # or community"
          value={filter.job}
          onChange={(event) => filter.setJob(event.target.value)}
          sx={{ minWidth: { sm: 220 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment>
              ),
            },
            htmlInput: { 'aria-label': `Filter ${label} by Job` },
          }}
        />
        {filter.submissionMethods.length > 0 && (
          <TextField
            select
            size="small"
            label="Submitted by"
            value={filter.submission}
            onChange={(event) => filter.setSubmission(event.target.value)}
            sx={{ minWidth: { sm: 180 } }}
            slotProps={{ htmlInput: { 'aria-label': `Filter ${label} by how they are submitted` } }}
          >
            <MenuItem value="">All</MenuItem>
            {filter.submissionMethods.map((method) => (
              <MenuItem key={method} value={method}>{submissionMethodLabels[method] ?? method}</MenuItem>
            ))}
          </TextField>
        )}
        {filter.isFiltering && (
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            Showing {filter.filtered.length} of {filter.total}
            {' · '}
            <Box
              component="button"
              type="button"
              onClick={filter.clear}
              sx={{ border: 0, p: 0, bgcolor: 'transparent', color: 'primary.main', cursor: 'pointer', font: 'inherit', fontWeight: 700 }}
            >
              Clear
            </Box>
          </Typography>
        )}
      </Stack>
    </Box>
  )
}

/** What a card says when the filter leaves nothing. */
export function NoSuggestionMatch({ filter }) {
  if (!filter.isFiltering || filter.filtered.length > 0) return null

  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Typography variant="body2" fontWeight={750}>No Job matches this filter</Typography>
      <Typography variant="body2" color="text.secondary">
        Change the Builder, the Job text or Submitted by, or clear the filter.
      </Typography>
    </Box>
  )
}
