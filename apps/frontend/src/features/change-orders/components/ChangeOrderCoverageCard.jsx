import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  InputAdornment,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'

import { coverageModes } from '../data/changeOrders.js'
import { useChangeOrderCoverage } from '../hooks/useChangeOrderCoverage.js'
import { buildCoverageTree, filterCoverageTree } from '../utils/coverage.js'
import CoverageTree from './CoverageTree.jsx'

const SELECTION_FIELD = { lots: 'lotIds', phase: 'recordIds', plans: 'planIds' }

const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`

// A flat list of the Job's Plans, ticked like the nodes of the tree.
function buildPlanNodes(job) {
  return (job?.sequenceSheet?.plans ?? []).map((plan) => ({
    id: `plan:${plan.id}`,
    label: plan.name ? `Plan ${plan.code} – ${plan.name}` : `Plan ${plan.code}`,
    leaves: [String(plan.id)],
    searchText: `plan ${plan.code} ${plan.name ?? ''}`,
    children: [],
  }))
}

// The lots the Extra / CO reaches, in the Job picked in the first card (Job / Community).
export default function ChangeOrderCoverageCard({ values, onChange }) {
  const [search, setSearch] = useState('')
  const mode = values.coverageMode
  const { job, summary } = useChangeOrderCoverage(values)

  const treeNodes = useMemo(() => {
    if (!job) return []
    if (mode === 'plans') return buildPlanNodes(job)
    return buildCoverageTree(job, mode === 'phase' ? 'record' : 'lot')
  }, [job, mode])
  const visibleNodes = useMemo(() => filterCoverageTree(treeNodes, search), [treeNodes, search])

  const selectionField = SELECTION_FIELD[mode]
  const selected = selectionField ? values[selectionField] : new Set()
  const setSelected = (next) => onChange({ [selectionField]: next })

  const handleModeChange = (event) => {
    setSearch('')
    onChange({ coverageMode: event.target.value })
  }

  const selectAll = () => setSelected(new Set(treeNodes.flatMap((node) => node.leaves)))

  return (
    <Box>
      <RadioGroup
        row
        value={mode}
        onChange={handleModeChange}
        aria-label="Coverage"
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' },
        }}
      >
        {coverageModes.map((option) => (
          <FormControlLabel
            key={option.value}
            value={option.value}
            control={<Radio size="small" sx={{ alignSelf: 'flex-start', mt: 0.25 }} />}
            label={(
              <Box>
                <Typography variant="body2" fontWeight={700}>{option.label}</Typography>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.35 }}>
                  {option.description}
                </Typography>
              </Box>
            )}
            sx={{
              m: 0,
              px: 1.25,
              py: 1,
              alignItems: 'flex-start',
              border: 1,
              borderRadius: 1.5,
              borderColor: mode === option.value ? 'primary.main' : 'divider',
              bgcolor: mode === option.value ? 'action.selected' : 'transparent',
              '&:hover': { borderColor: 'primary.main' },
            }}
          />
        ))}
      </RadioGroup>

      <Divider sx={{ my: 2.5 }} />

      {!job ? (
        <Typography variant="body2" color="text.secondary">
          Choose the Job in the Request step above, and its lots show up here to pick from.
        </Typography>
      ) : (
        <>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { md: 'center' }, mb: 2 }}
          >
            <TextField
              size="small"
              placeholder="Search phase, building, lot or plan type..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ flex: { md: '0 1 360px' } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
                htmlInput: { 'aria-label': 'Search affected locations' },
              }}
            />
            {mode !== 'job' && (
              <>
                <Button variant="outlined" color="inherit" size="small" onClick={selectAll}>
                  Select All
                </Button>
                <Button
                  variant="outlined"
                  color="inherit"
                  size="small"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </Button>
              </>
            )}
            <Chip
              aria-live="polite"
              color={summary.lots > 0 ? 'primary' : 'default'}
              variant={summary.lots > 0 ? 'filled' : 'outlined'}
              label={summary.lots === 0
                ? 'Nothing selected yet'
                : `${plural(summary.lots, 'lot')} · ${plural(summary.phases, 'phase')} · ${plural(summary.buildings, 'building')}`}
              sx={{ ml: { md: 'auto' }, fontWeight: 600 }}
            />
          </Stack>

          {mode === 'job' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Covers every Lot the Job has today. Lots of Phases added later are not part of it.
            </Alert>
          )}
          {mode === 'plans' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Covers every Lot that has the selected Plans today. Once approved, a Lot of these Plans added
              later is charged too, with its Plan's Scope and Amount, from the first Package that bills it.
            </Alert>
          )}

          {mode === 'lots' && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Open a phase and tick its lots, or tick the phase to take all of them.
            </Typography>
          )}
          {mode === 'phase' && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Tick the phases or buildings the work reaches; every lot in them is included.
            </Typography>
          )}
          {mode !== 'job' && (
            <Box
              sx={{
                maxHeight: 360,
                overflow: 'auto',
                p: 1,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1.5,
              }}
            >
              {/* The key reopens the Phases for another Job or kind of coverage. */}
              <CoverageTree
                key={`${job.id}-${mode}`}
                nodes={visibleNodes}
                selected={selected}
                onChange={setSelected}
                searching={Boolean(search.trim())}
              />
            </Box>
          )}
        </>
      )}
    </Box>
  )
}
