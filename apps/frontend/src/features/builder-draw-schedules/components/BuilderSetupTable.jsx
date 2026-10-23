import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Collapse,
  InputAdornment,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { retentionReleaseScopeLabels } from '../data/builderDrawSchedules.js'
import {
  SETUP_PAGE_SIZE,
  SETUP_SORTS,
  buildSetupRows,
  buildersWithoutSetup,
  drawBarSegments,
  emptySetupFilters,
  filterSetupRows,
  hasActiveFilters,
  pageOfRows,
  sortSetupRows,
} from '../utils/builderSetupList.js'
import { describeCutoff, formatSetupPercentage } from '../utils/setupSummary.js'
import BillingSetupSummary from './BillingSetupSummary.jsx'

// The Draws take the colors the Calendar already gives EXT, DM and HW, so they read at a glance.
const EVENT_COLORS = {
  light: { EXT: '#8b5cf6', DM: '#dc2626', HW: '#2563eb' },
  dark: { EXT: '#a78bfa', DM: '#f87171', HW: '#60a5fa' },
}

const COLUMNS = 'minmax(190px, 1.5fr) minmax(230px, 2fr) minmax(150px, 1.1fr) 76px 112px 64px 58px'

const FILTERS = [
  { key: 'cutoff:any', label: 'Any date' },
  { key: 'cutoff:fixed', label: 'Fixed cutoff' },
  { key: 'retention', label: 'Retention' },
  { key: 'wrap', label: 'OCIP / WRAP' },
  { key: 'utility', label: 'Utility' },
  { key: 'hardware', label: 'Hardware separate' },
]

function initials(builder) {
  const words = builder.name.trim().split(/\s+/u)
  return words.length > 1
    ? `${words[0][0]}${words[1][0]}`.toUpperCase()
    : builder.name.slice(0, 2).toUpperCase()
}

function retentionText(schedule) {
  if (!schedule.retentionEnabled) return null
  const scope = retentionReleaseScopeLabels[schedule.retentionReleaseScope]
  return `${formatSetupPercentage(schedule.retentionPercentage)}%${scope ? ` · ${scope.replace('Per ', '').toLowerCase()}` : ''}`
}

/** The Draws as one thin bar, each as wide as its share, in the colors of their events. */
function DrawBar({ schedule }) {
  const theme = useTheme()
  const colors = EVENT_COLORS[theme.palette.mode === 'dark' ? 'dark' : 'light']
  const { segments, total, complete } = drawBarSegments(schedule)
  const text = segments
    .map(({ eventType, percentage }) => `${eventType || 'Draw'} ${formatSetupPercentage(percentage)}%`)
    .join(', ')

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        role="img"
        aria-label={`Draws: ${text}${complete ? '' : `. They add up to ${formatSetupPercentage(total)}%, not 100%`}`}
        sx={{
          display: 'flex',
          gap: '2px',
          height: 8,
          borderRadius: 999,
          overflow: 'hidden',
          bgcolor: complete ? 'transparent' : 'action.selected',
          outline: complete ? 'none' : `1px solid ${theme.palette.warning.main}`,
        }}
      >
        {segments.map((segment) => (
          <Box
            key={segment.index}
            sx={{
              flex: `0 0 ${segment.share * 100}%`,
              minWidth: segment.percentage > 0 ? 4 : 0,
              bgcolor: colors[segment.eventType] ?? theme.palette.text.disabled,
            }}
          />
        ))}
      </Box>
      <Typography
        variant="caption"
        color={complete ? 'text.secondary' : 'warning.main'}
        noWrap
        sx={{ display: 'block', mt: 0.4, fontVariantNumeric: 'tabular-nums' }}
        title={text}
      >
        {segments.map(({ eventType, percentage }) => `${eventType || '—'} ${formatSetupPercentage(percentage)}`).join(' · ')}
        {!complete && ` · adds up to ${formatSetupPercentage(total)}`}
      </Typography>
    </Box>
  )
}

function Quiet({ children }) {
  return <Typography variant="body2" color="text.disabled">{children}</Typography>
}

function SetupRow({ row, open, onToggle, canManage, onEdit, onDeactivate, rowRef }) {
  const { builder, schedule } = row
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const retention = retentionText(schedule)
  const wrap = schedule.ocipWrapEnabled ? `${formatSetupPercentage(schedule.ocipWrapPercentage)}%` : null
  const bodyId = `builder-setup-${schedule.id}`

  return (
    <Box ref={rowRef} sx={{ borderTop: 1, borderColor: 'divider', scrollMarginTop: 80 }}>
      <ButtonBase
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        sx={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: COLUMNS },
          columnGap: 2,
          rowGap: 0.75,
          alignItems: 'center',
          textAlign: 'left',
          px: 1.5,
          py: 1.1,
          '&:hover': { bgcolor: 'action.hover' },
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          <ChevronRightRoundedIcon
            fontSize="small"
            sx={{
              color: 'text.secondary',
              flexShrink: 0,
              transform: open ? 'rotate(90deg)' : 'none',
              transition: reduceMotion ? 'none' : 'transform 150ms',
            }}
          />
          <Box
            aria-hidden="true"
            sx={{
              width: 34,
              height: 34,
              borderRadius: 1.5,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              bgcolor: 'primary.light',
              color: 'primary.main',
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {initials(builder)}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography fontWeight={750} noWrap>{builder.name}</Typography>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">{builder.code}</Typography>
              {schedule.utilityBuilding && (
                <Chip size="small" variant="outlined" label="Utility" sx={{ height: 18, fontSize: 11 }} />
              )}
              {schedule.separateHardwarePrice && (
                <Chip size="small" variant="outlined" label="Hardware" sx={{ height: 18, fontSize: 11 }} />
              )}
            </Stack>
          </Box>
        </Stack>

        <DrawBar schedule={schedule} />

        <Typography variant="body2" sx={{ display: { xs: 'none', lg: 'block' } }}>
          {describeCutoff(schedule)}
        </Typography>
        <Typography variant="body2" sx={{ display: { xs: 'none', lg: 'block' }, fontVariantNumeric: 'tabular-nums' }}>
          Net {schedule.paymentTermsDays}
        </Typography>
        <Box sx={{ display: { xs: 'none', lg: 'block' } }}>
          {retention ? <Typography variant="body2" fontWeight={650}>{retention}</Typography> : <Quiet>—</Quiet>}
        </Box>
        <Box sx={{ display: { xs: 'none', lg: 'block' } }}>
          {wrap ? <Typography variant="body2" fontWeight={650}>{wrap}</Typography> : <Quiet>—</Quiet>}
        </Box>
        <Chip
          size="small"
          variant="outlined"
          label={`v${schedule.versionNumber}`}
          sx={{ display: { xs: 'none', lg: 'inline-flex' }, justifySelf: 'start' }}
        />

        {/* On a narrower screen the figures that matter sit on one line under the Draws. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'block', lg: 'none' } }}>
          v{schedule.versionNumber} · {describeCutoff(schedule)} · Net {schedule.paymentTermsDays}
          {retention ? ` · Retention ${retention}` : ''}
          {wrap ? ` · Wrap ${wrap}` : ''}
        </Typography>
      </ButtonBase>

      <Collapse in={open} unmountOnExit timeout={reduceMotion ? 0 : 'auto'}>
        <Box id={bodyId} sx={{ px: { xs: 1.5, lg: 6 }, pb: 2, pt: 0.5 }}>
          <BillingSetupSummary setup={schedule} title="Current setup">
            {canManage && (
              <>
                <Button
                  size="small"
                  startIcon={<EditOutlinedIcon />}
                  onClick={() => onEdit(schedule)}
                  sx={{ textTransform: 'none' }}
                >
                  Edit
                </Button>
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteOutlineRoundedIcon />}
                  onClick={() => onDeactivate(schedule)}
                  sx={{ textTransform: 'none' }}
                >
                  Deactivate
                </Button>
              </>
            )}
          </BillingSetupSummary>
        </Box>
      </Collapse>
    </Box>
  )
}

/**
 * The Builders and their current billing setups as a table: one line each, with the Draws drawn as
 * a bar so Builders compare at a glance. A line opens onto the whole setup and its actions. It can
 * be searched, filtered and sorted, and it lists the Builders that still have no setup.
 * `focusBuilderId` opens that Builder's line and scrolls to it (the link from Create Job).
 */
export default function BuilderSetupTable({
  schedules,
  builders,
  canManage,
  focusBuilderId = null,
  onEdit,
  onDeactivate,
  onCreateFor,
}) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState(emptySetupFilters)
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [openIds, setOpenIds] = useState(() => new Set())
  const focusedRef = useRef(null)
  const handledFocus = useRef(null)

  const allRows = useMemo(() => buildSetupRows(schedules, builders), [schedules, builders])
  const rows = useMemo(
    () => sortSetupRows(filterSetupRows(allRows, { query, filters }), sort),
    [allRows, query, filters, sort],
  )
  const paged = pageOfRows(rows, page)
  const missing = useMemo(() => buildersWithoutSetup(builders, schedules), [builders, schedules])
  const filtering = hasActiveFilters({ query, filters })

  // The Builder a link points at: its page, its line open, scrolled into view, once.
  useEffect(() => {
    if (focusBuilderId == null || handledFocus.current === String(focusBuilderId)) return
    const target = allRows.find(({ builder }) => String(builder.id) === String(focusBuilderId))
    if (!target) return

    handledFocus.current = String(focusBuilderId)
    // Rows start in name order: the page that holds the Builder.
    const sorted = sortSetupRows(allRows, 'name')
    const position = sorted.findIndex(({ key }) => key === target.key)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(Math.floor(position / SETUP_PAGE_SIZE) + 1)
    setOpenIds((current) => new Set(current).add(target.key))
    requestAnimationFrame(() => focusedRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [allRows, focusBuilderId])

  const toggleFilter = (key) => {
    setPage(1)
    setFilters((current) => {
      if (key === 'cutoff:any') return { ...current, cutoff: current.cutoff === 'any' ? null : 'any' }
      if (key === 'cutoff:fixed') return { ...current, cutoff: current.cutoff === 'fixed' ? null : 'fixed' }
      return { ...current, [key]: !current[key] }
    })
  }
  const isOn = (key) => (key.startsWith('cutoff:') ? filters.cutoff === key.split(':')[1] : filters[key])
  const toggleRow = (id) => setOpenIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const clear = () => {
    setQuery('')
    setFilters(emptySetupFilters)
    setPage(1)
  }

  return (
    <Stack spacing={2}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ alignItems: { sm: 'center' } }}>
          <TextField
            size="small"
            placeholder="Search builders by name or code"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            sx={{ flex: 1, maxWidth: { sm: 420 } }}
            slotProps={{
              htmlInput: { 'aria-label': 'Search builders' },
              input: {
                startAdornment: (
                  <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment>
                ),
                endAdornment: query ? (
                  <InputAdornment position="end">
                    <ButtonBase aria-label="Clear search" onClick={() => setQuery('')} sx={{ borderRadius: '50%', p: 0.25 }}>
                      <ClearRoundedIcon fontSize="small" />
                    </ButtonBase>
                  </InputAdornment>
                ) : null,
              },
            }}
          />
          <TextField
            select
            size="small"
            label="Sort by"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            sx={{ minWidth: 220 }}
          >
            {SETUP_SORTS.map((option) => (
              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
            ))}
          </TextField>
        </Stack>

        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {FILTERS.map((filter) => (
            <Chip
              key={filter.key}
              size="small"
              clickable
              color={isOn(filter.key) ? 'primary' : 'default'}
              variant={isOn(filter.key) ? 'filled' : 'outlined'}
              label={filter.label}
              aria-pressed={Boolean(isOn(filter.key))}
              onClick={() => toggleFilter(filter.key)}
            />
          ))}
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" color="text.secondary" aria-live="polite">
            {filtering
              ? `${rows.length} of ${allRows.length} ${allRows.length === 1 ? 'builder' : 'builders'}`
              : `${allRows.length} ${allRows.length === 1 ? 'builder' : 'builders'} with a setup`}
          </Typography>
          {filtering && (
            <Button size="small" onClick={clear} sx={{ textTransform: 'none' }}>Clear filters</Button>
          )}
          {openIds.size > 0 && (
            <Button size="small" color="inherit" onClick={() => setOpenIds(new Set())} sx={{ textTransform: 'none' }}>
              Collapse all
            </Button>
          )}
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2 }}>
        <Box
          aria-hidden="true"
          sx={{
            display: { xs: 'none', lg: 'grid' },
            gridTemplateColumns: COLUMNS,
            columnGap: 2,
            px: 1.5,
            py: 0.9,
            bgcolor: 'action.hover',
          }}
        >
          {['Builder', 'Draws', 'Cutoff', 'Terms', 'Retention', 'OCIP / WRAP', 'Version'].map((label) => (
            <Typography key={label} variant="caption" color="text.secondary" fontWeight={700}>
              {label}
            </Typography>
          ))}
        </Box>

        {paged.rows.map((row) => {
          const focused = focusBuilderId != null && String(row.builder.id) === String(focusBuilderId)
          return (
            <SetupRow
              key={row.key}
              row={row}
              open={openIds.has(row.key)}
              onToggle={() => toggleRow(row.key)}
              canManage={canManage}
              onEdit={onEdit}
              onDeactivate={onDeactivate}
              rowRef={focused ? focusedRef : undefined}
            />
          )
        })}

        {rows.length === 0 && (
          <Box sx={{ p: 4, textAlign: 'center', borderTop: 1, borderColor: 'divider' }}>
            <Typography fontWeight={750}>No builder matches</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Try another name, or take a filter off.
            </Typography>
            <Button size="small" onClick={clear} sx={{ textTransform: 'none' }}>Clear filters</Button>
          </Box>
        )}
      </Paper>

      {paged.pages > 1 && (
        <Stack sx={{ alignItems: 'center' }}>
          <Pagination
            count={paged.pages}
            page={paged.page}
            onChange={(_, next) => setPage(next)}
            shape="rounded"
            size="small"
          />
        </Stack>
      )}

      {missing.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 1.75, py: 1.1, bgcolor: 'action.hover' }}>
            <Typography fontWeight={800}>
              Builders without a setup ({missing.length})
            </Typography>
            <Typography variant="caption" color="text.secondary">
              A Builder needs a billing setup before it can have Jobs.
            </Typography>
          </Box>
          {missing.map((builder) => (
            <Stack
              key={builder.id}
              direction="row"
              spacing={1}
              sx={{ px: 1.75, py: 0.75, alignItems: 'center', borderTop: 1, borderColor: 'divider' }}
            >
              <Typography sx={{ flex: 1, minWidth: 0 }} noWrap>
                {builder.name}
                <Typography component="span" variant="caption" color="text.secondary">
                  {' '}{builder.code}
                </Typography>
              </Typography>
              {canManage && (
                <Tooltip title={`Create the billing setup of ${builder.name}`}>
                  <Button
                    size="small"
                    startIcon={<AddRoundedIcon />}
                    onClick={() => onCreateFor(builder)}
                    sx={{ textTransform: 'none' }}
                  >
                    Create setup
                  </Button>
                </Tooltip>
              )}
            </Stack>
          ))}
        </Paper>
      )}
    </Stack>
  )
}
