import { useMemo, useState } from 'react'
import { Alert, Box, Chip, Paper, Stack, Typography } from '@mui/material'
import {
  roadmapAreas,
  roadmapStatuses,
  roadmapUpdatedOn,
} from '../data/roadmap.js'

const statusKeys = Object.keys(roadmapStatuses)

function RoadmapItem({ title, status, description }) {
  const { label, color } = roadmapStatuses[status]
  const needsInput = status === 'INPUT'

  return (
    <Box
      component="li"
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'baseline' },
        gap: { xs: 0.75, sm: 2 },
        py: 1.5,
        pl: needsInput ? 1.5 : 0,
        borderLeft: needsInput ? 3 : 0,
        borderColor: 'warning.main',
        '&:not(:last-of-type)': { borderBottom: 1, borderBottomColor: 'divider' },
      }}
    >
      <Chip
        label={label}
        color={color}
        size="small"
        variant={status === 'PLANNED' ? 'outlined' : 'filled'}
        sx={{ flexShrink: 0, minWidth: { sm: 132 } }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" fontWeight={700} color="text.primary">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {description}
        </Typography>
      </Box>
    </Box>
  )
}

export default function Roadmap() {
  const [statusFilter, setStatusFilter] = useState('ALL')

  const counts = useMemo(() => {
    const totals = { ALL: 0 }
    for (const area of roadmapAreas) {
      for (const { status } of area.items) {
        totals[status] = (totals[status] ?? 0) + 1
        totals.ALL += 1
      }
    }
    return totals
  }, [])

  const visibleAreas = roadmapAreas
    .map((area) => ({
      ...area,
      items: area.items.filter(
        ({ status }) => statusFilter === 'ALL' || status === statusFilter,
      ),
    }))
    .filter((area) => area.items.length > 0)

  const filters = [
    { key: 'ALL', label: 'All', color: 'primary' },
    ...statusKeys.map((key) => ({ key, ...roadmapStatuses[key] })),
  ]

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 3,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="h5" fontWeight={700} color="text.primary">
          Roadmap
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          What is done, what comes next and where we need your input. Updated{' '}
          {roadmapUpdatedOn}.
        </Typography>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 }, maxWidth: 1100 }}>
        <Alert severity="info" sx={{ mb: 3 }}>
          This preview runs the newest Customer Service work. The newest Billing
          work (Extra / Change Orders, accounts receivable and the latest
          QuickBooks changes) is already in the live app, so some Billing
          screens here look older than the list below.
        </Alert>

        <Stack
          direction="row"
          useFlexGap
          sx={{ flexWrap: 'wrap', gap: 1, mb: 3 }}
          role="group"
          aria-label="Filter by status"
        >
          {filters.map(({ key, label, color }) => {
            const selected = statusFilter === key
            return (
              <Chip
                key={key}
                label={`${label} (${counts[key] ?? 0})`}
                color={selected ? color : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                onClick={() => setStatusFilter(key)}
                aria-pressed={selected}
              />
            )
          })}
        </Stack>

        <Stack spacing={2.5}>
          {visibleAreas.map((area, index) => (
            <Paper
              key={area.title}
              variant="outlined"
              component="section"
              aria-labelledby={`roadmap-area-${index}`}
              sx={{ px: { xs: 2, md: 3 }, py: 2, borderRadius: 2 }}
            >
              <Typography
                id={`roadmap-area-${index}`}
                variant="h6"
                fontWeight={700}
                color="text.primary"
              >
                {area.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {area.description}
              </Typography>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {area.items.map((item) => (
                  <RoadmapItem key={item.title} {...item} />
                ))}
              </Box>
            </Paper>
          ))}
        </Stack>
      </Box>
    </Box>
  )
}
