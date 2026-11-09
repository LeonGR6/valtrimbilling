import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
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
            control={<Radio size="small" />}
            label={option.label}
            sx={{
              m: 0,
              px: 1,
              py: 0.5,
              border: 1,
              borderRadius: 1.5,
              borderColor: mode === option.value ? 'primary.main' : 'divider',
              bgcolor: mode === option.value ? 'action.selected' : 'transparent',
            }}
          />
        ))}
      </RadioGroup>

      <Divider sx={{ my: 2.5 }} />

      {!job ? (
        <Typography variant="body2" color="text.secondary">
          Choose the Job / Community in the Request section to pick the affected locations.
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
            <Typography
              variant="body2"
              aria-live="polite"
              sx={{ ml: { md: 'auto' }, fontWeight: 600, color: summary.lots > 0 ? 'primary.main' : 'text.secondary' }}
            >
              {summary.lots === 0
                ? 'Nothing selected yet'
                : `${plural(summary.lots, 'lot')} in ${plural(summary.phases, 'phase')} and ${plural(summary.buildings, 'building')}`}
            </Typography>
          </Stack>

          {mode === 'job' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              The whole Job is covered, including any Phase added to it later.
            </Alert>
          )}
          {mode === 'plans' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Covers every Lot with the selected Plans, including the Lots of Phases added later.
            </Alert>
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
