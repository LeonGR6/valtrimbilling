import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ContactPhoneRoundedIcon from '@mui/icons-material/ContactPhoneRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import EngineeringRoundedIcon from '@mui/icons-material/EngineeringRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import {
  auditActionDetails,
  auditModuleDetails,
  getAuditActionDetails,
  getAuditModuleLabel,
} from '../data/auditMetadata.js'
import {
  getAuditStats,
  listAuditEvents,
} from '../services/activityHistoryRepository.js'

const actionIcons = {
  USER_INVITED: MailOutlineRoundedIcon,
  INVITATION_RESENT: MailOutlineRoundedIcon,
  USER_UPDATED: ManageAccountsRoundedIcon,
  ROLE_CHANGED: AdminPanelSettingsRoundedIcon,
  PROJECT_ACCESS_CHANGED: ManageAccountsRoundedIcon,
  USER_DEACTIVATED: PersonOffOutlinedIcon,
  USER_REACTIVATED: CheckCircleOutlineRoundedIcon,
  BUILDER_CONTACT_CREATED: ContactPhoneRoundedIcon,
  BUILDER_CONTACT_UPDATED: EditOutlinedIcon,
  BUILDER_CONTACT_DEACTIVATED: PersonOffOutlinedIcon,
  BUILDER_CONTACT_REACTIVATED: CheckCircleOutlineRoundedIcon,
  BUILDER_CREATED: BusinessRoundedIcon,
  BUILDER_UPDATED: EditOutlinedIcon,
  BUILDER_DEACTIVATED: BlockRoundedIcon,
  BUILDER_REACTIVATED: CheckCircleOutlineRoundedIcon,
  SUPERVISOR_CREATED: EngineeringRoundedIcon,
  SUPERVISOR_UPDATED: EditOutlinedIcon,
  SUPERVISOR_DEACTIVATED: PersonOffOutlinedIcon,
  SUPERVISOR_REACTIVATED: CheckCircleOutlineRoundedIcon,
  ACTION_REJECTED: BlockRoundedIcon,
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatDateTime(value) {
  return dateTimeFormatter.format(new Date(value))
}

function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function formatFieldLabel(value) {
  const words = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase()

  return words.replace(/^./, (character) => character.toUpperCase())
}

function StatTile({ label, value, icon: Icon, color }) {
  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        p: 2.5,
      }}
    >
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Box
          sx={(theme) => ({
            width: 48,
            height: 48,
            flexShrink: 0,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color: `${color}.main`,
            bgcolor: alpha(theme.palette[color].main, 0.12),
          })}
        >
          <Icon />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
          <Typography variant="h4" fontWeight={700} color="text.primary">
            {value}
          </Typography>
        </Box>
      </Stack>
    </Box>
  )
}

function ActionCell({ action }) {
  const details = getAuditActionDetails(action)
  const Icon = actionIcons[action] ?? HistoryRoundedIcon

  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
      <Box
        sx={(theme) => ({
          width: 34,
          height: 34,
          flexShrink: 0,
          borderRadius: 1.5,
          display: 'grid',
          placeItems: 'center',
          color: `${details.color}.main`,
          bgcolor: alpha(theme.palette[details.color].main, 0.1),
        })}
      >
        <Icon fontSize="small" />
      </Box>
      <Typography variant="body2" fontWeight={600} noWrap>
        {details.label}
      </Typography>
    </Stack>
  )
}

function PersonCell({ person }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
      <Avatar
        sx={{
          width: 32,
          height: 32,
          bgcolor: 'primary.light',
          color: 'primary.main',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {getInitials(person.name)}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} noWrap>
          {person.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div" noWrap>
          {person.email}
        </Typography>
      </Box>
    </Stack>
  )
}

function ResultChip({ result }) {
  const details = {
    SUCCESS: { label: 'Successful', color: 'success' },
    REJECTED: { label: 'Rejected', color: 'error' },
    FAILED: { label: 'Failed', color: 'error' },
  }[result] ?? { label: result, color: 'default' }

  return (
    <Chip
      label={details.label}
      color={details.color}
      size="small"
      variant="outlined"
    />
  )
}

function ValueList({ title, values, color = 'text.primary' }) {
  const entries = Object.entries(values)

  return (
    <Box
      sx={{
        minWidth: 0,
        flex: 1,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        p: 2,
        bgcolor: 'background.default',
      }}
    >
      <Typography variant="caption" color="text.secondary" fontWeight={700}>
        {title}
      </Typography>
      <Stack spacing={1.25} sx={{ mt: 1.25 }}>
        {entries.length === 0 && (
          <Typography variant="body2" color="text.secondary">No values</Typography>
        )}
        {entries.map(([label, value]) => (
          <Box key={label}>
            <Typography variant="caption" color="text.secondary" component="div">
              {formatFieldLabel(label)}
            </Typography>
            <Typography variant="body2" fontWeight={600} color={color}>
              {value === null || value === undefined
                ? 'None'
                : Array.isArray(value)
                ? value.join(', ') || 'None'
                : typeof value === 'object' && value !== null
                  ? JSON.stringify(value)
                  : typeof value === 'boolean'
                    ? value ? 'Yes' : 'No'
                    : String(value)}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  )
}

function EventDetailsDrawer({ event, onClose }) {
  if (!event) return null

  const details = getAuditActionDetails(event.action)
  const Icon = actionIcons[event.action] ?? HistoryRoundedIcon

  return (
    <Drawer
      anchor="right"
      open={Boolean(event)}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', sm: 480 },
            bgcolor: 'background.paper',
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', p: 2.5 }}
        >
          <Box>
            <Typography variant="h6" fontWeight={700}>Event details</Typography>
            <Typography variant="body2" color="text.secondary">
              Audit record {event.id}
            </Typography>
          </Box>
          <IconButton aria-label="Close event details" onClick={onClose}>
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
        <Divider />

        <Box sx={{ p: 3, overflowY: 'auto' }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 3 }}>
            <Box
              sx={(theme) => ({
                width: 46,
                height: 46,
                borderRadius: 2,
                display: 'grid',
                placeItems: 'center',
                color: `${details.color}.main`,
                bgcolor: alpha(theme.palette[details.color].main, 0.12),
              })}
            >
              <Icon />
            </Box>
            <Box sx={{ flexGrow: 1 }}>
              <Typography fontWeight={700}>{details.label}</Typography>
              <Typography variant="body2" color="text.secondary">
                {event.summary}
              </Typography>
            </Box>
            <ResultChip result={event.result} />
          </Stack>

          <Stack spacing={2.25}>
            <Box>
              <Typography variant="caption" color="text.secondary">Performed by</Typography>
              <PersonCell person={event.actor} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Affected record</Typography>
              <PersonCell person={event.target} />
            </Box>
            {event.entityType === 'BUILDER_CONTACT' && (
              <Stack direction="row" spacing={4}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Builder</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {event.metadata.builderName ?? 'Unknown builder'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Contact type</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {event.metadata.contactType
                      ? formatFieldLabel(event.metadata.contactType)
                      : 'Unknown type'}
                  </Typography>
                </Box>
              </Stack>
            )}
            {event.entityType === 'BUILDER' && (
              <Stack direction="row" spacing={4}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Builder code</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {event.metadata.builderCode ?? 'Unknown code'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Status</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {event.metadata.isActive === undefined
                      ? 'Unknown'
                      : event.metadata.isActive ? 'Active' : 'Inactive'}
                  </Typography>
                </Box>
              </Stack>
            )}
            {event.entityType === 'SUPERVISOR' && (
              <Stack direction="row" spacing={4}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">Email</Typography>
                  <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                    {event.metadata.supervisorEmail ?? 'No email'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Territory</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {event.metadata.territory ?? 'Not assigned'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Status</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {event.metadata.isActive === undefined
                      ? 'Unknown'
                      : event.metadata.isActive ? 'Active' : 'Inactive'}
                  </Typography>
                </Box>
              </Stack>
            )}
            <Stack direction="row" spacing={4}>
              <Box>
                <Typography variant="caption" color="text.secondary">Date and time</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {formatDateTime(event.occurredAt)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Source</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {getAuditModuleLabel(event.source)}
                </Typography>
              </Box>
            </Stack>
          </Stack>

          <Divider sx={{ my: 3 }} />
          <Typography fontWeight={700} sx={{ mb: 1.5 }}>Changes</Typography>
          {Array.isArray(event.metadata.changedFields)
            && event.metadata.changedFields.length > 0 && (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
                {event.metadata.changedFields.map((field) => (
                  <Chip key={field} size="small" label={formatFieldLabel(field)} />
                ))}
              </Stack>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <ValueList title="Before" values={event.previousValues} />
            <ValueList
              title="After"
              values={event.nextValues}
              color={event.result === 'SUCCESS' ? 'primary.main' : 'error.main'}
            />
          </Stack>
          {event.metadata.notesChanged && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              Notes changed. Their content is not copied into the audit history.
            </Typography>
          )}
        </Box>
      </Box>
    </Drawer>
  )
}

export default function ActivityHistory() {
  const [events, setEvents] = useState([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState({
    eventsToday: 0,
    userEvents: 0,
    catalogChanges: 0,
    problemEvents: 0,
  })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [statsError, setStatsError] = useState(null)
  const [search, setSearch] = useState('')
  const [moduleFilter, setModuleFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [resultFilter, setResultFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState('30')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const deferredSearch = useDeferredValue(search)

  const refreshEvents = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const result = await listAuditEvents({
        search: deferredSearch,
        module: moduleFilter,
        action: actionFilter,
        result: resultFilter,
        period: periodFilter,
        page,
        rowsPerPage,
      })
      setEvents(result.events)
      setTotal(result.total)
    } catch (error) {
      setEvents([])
      setTotal(0)
      setLoadError(error.message || 'The activity history could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [
    actionFilter,
    deferredSearch,
    moduleFilter,
    page,
    periodFilter,
    resultFilter,
    rowsPerPage,
  ])

  const refreshStats = useCallback(async () => {
    setStatsError(null)
    try {
      setSummary(await getAuditStats())
    } catch (error) {
      setStatsError(error.message || 'The activity summary could not be loaded.')
    }
  }, [])

  useEffect(() => {
    // Supabase is the external source for this administrative view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshEvents()
  }, [refreshEvents])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshStats()
  }, [refreshStats])

  const stats = useMemo(
    () => [
      {
        label: 'Events today',
        value: summary.eventsToday,
        icon: HistoryRoundedIcon,
        color: 'primary',
      },
      {
        label: 'User activity',
        value: summary.userEvents,
        icon: ManageAccountsRoundedIcon,
        color: 'info',
      },
      {
        label: 'Catalog changes',
        value: summary.catalogChanges,
        icon: BusinessRoundedIcon,
        color: 'warning',
      },
      {
        label: 'Rejected or failed',
        value: summary.problemEvents,
        icon: BlockRoundedIcon,
        color: 'error',
      },
    ],
    [summary],
  )

  const clearFilters = () => {
    setSearch('')
    setModuleFilter('all')
    setActionFilter('all')
    setResultFilter('all')
    setPeriodFilter('30')
    setPage(0)
  }

  const hasFilters = Boolean(search)
    || moduleFilter !== 'all'
    || actionFilter !== 'all'
    || resultFilter !== 'all'
    || periodFilter !== '30'

  const handleRefresh = () => {
    refreshEvents()
    refreshStats()
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 2,
          px: { xs: 2.5, md: 4 },
          py: 3,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700} color="text.primary">
            Activity History
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Review important actions performed across ValtrimBilling.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={loading ? <CircularProgress size={16} /> : <RefreshRoundedIcon />}
          disabled={loading}
          onClick={handleRefresh}
        >
          Refresh
        </Button>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {(loadError || statsError) && (
          <Alert
            severity="error"
            action={(
              <Button color="inherit" size="small" onClick={handleRefresh}>
                Retry
              </Button>
            )}
            sx={{ mb: 2.5 }}
          >
            {loadError ?? statsError}
          </Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              lg: 'repeat(4, 1fr)',
            },
            mb: { xs: 2.5, md: 3 },
          }}
        >
          {stats.map((stat) => <StatTile key={stat.label} {...stat} />)}
        </Box>

        <Box
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            spacing={1.5}
            sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}
          >
            <TextField
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(0)
              }}
              size="small"
              placeholder="Search user, contact, builder or record..."
              sx={{ width: { xs: '100%', lg: 330 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <FormControl size="small" sx={{ minWidth: 165 }}>
              <InputLabel id="history-module-filter-label">Module</InputLabel>
              <Select
                labelId="history-module-filter-label"
                label="Module"
                value={moduleFilter}
                onChange={(event) => {
                  setModuleFilter(event.target.value)
                  setPage(0)
                }}
              >
                <MenuItem value="all">All modules</MenuItem>
                {Object.entries(auditModuleDetails).map(([value, details]) => (
                  <MenuItem key={value} value={value}>{details.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 210 }}>
              <InputLabel id="history-action-filter-label">Action</InputLabel>
              <Select
                labelId="history-action-filter-label"
                label="Action"
                value={actionFilter}
                onChange={(event) => {
                  setActionFilter(event.target.value)
                  setPage(0)
                }}
              >
                <MenuItem value="all">All actions</MenuItem>
                {Object.entries(auditActionDetails).map(([value, details]) => (
                  <MenuItem key={value} value={value}>{details.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id="history-result-filter-label">Result</InputLabel>
              <Select
                labelId="history-result-filter-label"
                label="Result"
                value={resultFilter}
                onChange={(event) => {
                  setResultFilter(event.target.value)
                  setPage(0)
                }}
              >
                <MenuItem value="all">All results</MenuItem>
                <MenuItem value="SUCCESS">Successful</MenuItem>
                <MenuItem value="REJECTED">Rejected</MenuItem>
                <MenuItem value="FAILED">Failed</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 165 }}>
              <InputLabel id="history-period-filter-label">Period</InputLabel>
              <Select
                labelId="history-period-filter-label"
                label="Period"
                value={periodFilter}
                onChange={(event) => {
                  setPeriodFilter(event.target.value)
                  setPage(0)
                }}
              >
                <MenuItem value="1">Today</MenuItem>
                <MenuItem value="7">Last 7 days</MenuItem>
                <MenuItem value="30">Last 30 days</MenuItem>
                <MenuItem value="all">All time</MenuItem>
              </Select>
            </FormControl>
            <Button
              variant="text"
              startIcon={<TuneRoundedIcon />}
              disabled={!hasFilters}
              onClick={clearFilters}
              sx={{ ml: { lg: 'auto' } }}
            >
              Clear filters
            </Button>
          </Stack>

          <TableContainer>
            <Table sx={{ minWidth: 1280 }}>
              <TableHead>
                <TableRow
                  sx={{
                    bgcolor: 'sidebar.bg',
                    '& .MuiTableCell-root': {
                      color: 'text.secondary',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    },
                  }}
                >
                  <TableCell>Date</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Performed by</TableCell>
                  <TableCell>Affected record</TableCell>
                  <TableCell>Details</TableCell>
                  <TableCell>Result</TableCell>
                  <TableCell align="right" width={72}>View</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ py: 8, textAlign: 'center' }}>
                      <CircularProgress size={32} aria-label="Loading activity history" />
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                        Loading activity history…
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && events.map((event) => (
                  <TableRow
                    key={event.id}
                    hover
                    selected={selectedEvent?.id === event.id}
                    onClick={() => setSelectedEvent(event)}
                    sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {formatDateTime(event.occurredAt)}
                      </Typography>
                    </TableCell>
                    <TableCell><ActionCell action={event.action} /></TableCell>
                    <TableCell><PersonCell person={event.actor} /></TableCell>
                    <TableCell><PersonCell person={event.target} /></TableCell>
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Typography variant="body2" color="text.secondary">
                        {event.summary}
                      </Typography>
                    </TableCell>
                    <TableCell><ResultChip result={event.result} /></TableCell>
                    <TableCell align="right">
                      <Tooltip title="View event details">
                        <IconButton
                          size="small"
                          aria-label={`View details for ${getAuditActionDetails(event.action).label}`}
                        >
                          <VisibilityOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}

                {!loading && !loadError && events.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ py: 8, textAlign: 'center' }}>
                      <SearchRoundedIcon color="action" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography fontWeight={600}>No events found</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Try changing the search, module, action, result or period filters.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, nextPage) => setPage(nextPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(Number(event.target.value))
              setPage(0)
            }}
            rowsPerPageOptions={[5, 10, 25]}
          />
        </Box>
      </Box>

      <EventDetailsDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </Box>
  )
}
