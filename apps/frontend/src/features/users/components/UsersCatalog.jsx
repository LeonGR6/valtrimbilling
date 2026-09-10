import { useCallback, useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import GroupRoundedIcon from '@mui/icons-material/GroupRounded'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import PendingActionsRoundedIcon from '@mui/icons-material/PendingActionsRounded'
import PersonOffRoundedIcon from '@mui/icons-material/PersonOffRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import { useAuth } from '../../auth/context/useAuth.js'
import {
  formatPhoneNumber,
  getNationalPhoneNumber,
  getPhoneCountry,
} from '../../../utils/phoneNumbers.js'
import {
  emptyUser,
  isScopedRole,
  userRoleDescriptions,
  userRoleLabels,
  userRoleOptions,
  userStatusByValue,
  userStatusOptions,
} from '../data/users.js'
import { createUserSchema } from '../schemas/userSchema.js'
import {
  inviteUser,
  listUsers,
  resendInvitation,
  setUserActive,
  updateUser,
} from '../services/usersRepository.js'

function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function getUserFormValues(user) {
  if (!user) return { ...emptyUser, phoneCountry: 'US' }

  const phoneCountry = getPhoneCountry(user.phone)
  return {
    ...user,
    phoneCountry,
    phone: getNationalPhoneNumber(user.phone, phoneCountry),
  }
}

// Summary tile shown above the table. `color` is a theme palette key, so the
// tinted badge follows light and dark mode without hardcoded values.
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

function communityLabel(community) {
  const code = community.code ? `${community.code} — ` : ''
  const inactive = community.isActive ? '' : ' (Inactive)'
  return `${code}${community.name}${inactive}`
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatDateTime(value, fallback = '—') {
  if (!value) return fallback

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : dateTimeFormatter.format(date)
}

function UserStatusChip({ status }) {
  const details = userStatusByValue[status] ?? {
    label: 'Unknown',
    color: 'default',
  }

  return (
    <Chip
      label={details.label}
      color={details.color}
      size="small"
      variant="outlined"
    />
  )
}

function UserDialog({ communities, saving, user, users, onClose, onSave }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createUserSchema(users, user?.id ?? null)),
    defaultValues: getUserFormValues(user),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

  // The scope selector only applies to roles that can be limited to specific
  // communities, and the project picker only when they actually are.
  const selectedRole = useWatch({ control, name: 'role' })
  const allProjects = useWatch({ control, name: 'allProjects' })
  const showScopeSelector = isScopedRole(selectedRole)
  const showProjectPicker = showScopeSelector && !allProjects

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {user ? 'Edit user' : 'New user'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {user
            ? 'Update the contact information and access level.'
            : 'Send an invitation so the user can choose their password.'}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.25}>
          <TextField
            label="Name"
            {...register('name')}
            error={Boolean(errors.name)}
            helperText={errors.name?.message ?? ' '}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />

          <TextField
            label="Email"
            type="email"
            {...register('email')}
            error={Boolean(errors.email)}
            helperText={errors.email?.message ?? 'Used to sign in.'}
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MailOutlineRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: { maxLength: 160 },
            }}
          />

          <FormPhoneInput
            control={control}
            name="phone"
            label="Phone number"
            error={errors.phone}
            helperText="Optional · choose +1 or +52"
          />

          <Controller
            name="role"
            control={control}
            render={({ field }) => (
              <FormControl error={Boolean(errors.role)} fullWidth>
                <InputLabel id="user-role-label">Role</InputLabel>
                <Select
                  labelId="user-role-label"
                  label="Role"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                >
                  {userRoleOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  {errors.role?.message ?? userRoleDescriptions[field.value]}
                </FormHelperText>
              </FormControl>
            )}
          />

          {showScopeSelector && (
            <Controller
              name="allProjects"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth>
                  <InputLabel id="user-scope-label">Project access</InputLabel>
                  <Select
                    labelId="user-scope-label"
                    label="Project access"
                    value={field.value ? 'all' : 'selected'}
                    onChange={(event) =>
                      field.onChange(event.target.value === 'all')
                    }
                    onBlur={field.onBlur}
                  >
                    <MenuItem value="all">All projects</MenuItem>
                    <MenuItem value="selected">Selected projects</MenuItem>
                  </Select>
                </FormControl>
              )}
            />
          )}

          {showProjectPicker && (
            <Controller
              name="projectAccess"
              control={control}
              render={({ field }) => (
                <Autocomplete
                  multiple
                  disableCloseOnSelect
                  options={communities.map((community) => community.id)}
                  getOptionLabel={(communityId) => {
                    const community = communities.find(({ id }) => id === communityId)
                    return community ? communityLabel(community) : String(communityId)
                  }}
                  value={field.value}
                  onChange={(_, nextValue) => field.onChange(nextValue)}
                  onBlur={field.onBlur}
                  size="small"
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Projects"
                      placeholder="Add project"
                      error={Boolean(errors.projectAccess)}
                      helperText={
                        errors.projectAccess?.message ??
                        'The user only sees the projects listed here.'
                      }
                    />
                  )}
                />
              )}
            />
          )}

          {user && (
            <Controller
              name="isActive"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth>
                  <InputLabel id="user-status-label">Status</InputLabel>
                  <Select
                    labelId="user-status-label"
                    label="Status"
                    value={field.value ? 'active' : 'inactive'}
                    onChange={(event) =>
                      field.onChange(event.target.value === 'active')
                    }
                    onBlur={field.onBlur}
                  >
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="inactive">Inactive</MenuItem>
                  </Select>
                  <FormHelperText>
                    {field.value
                      ? 'The user can sign in.'
                      : 'The user keeps their history but cannot sign in.'}
                  </FormHelperText>
                </FormControl>
              )}
            />
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={saving} disableElevation>
          {saving ? 'Saving…' : user ? 'Save changes' : 'Send invitation'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function UsersCatalog() {
  const { profile, refreshProfile } = useAuth()
  const [users, setUsers] = useState([])
  const [communities, setCommunities] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [dialogState, setDialogState] = useState(null)
  const [statusTarget, setStatusTarget] = useState(null)
  const [resendTarget, setResendTarget] = useState(null)
  const [notice, setNotice] = useState(null)
  const canManageUsers = profile?.role === 'ADMIN'

  const projectLabels = useMemo(() => Object.fromEntries(
    communities.map((community) => [community.id, communityLabel(community)]),
  ), [communities])

  const refreshUsers = useCallback(async ({ showLoading = true } = {}) => {
    if (!canManageUsers || !profile?.id) {
      setUsers([])
      setCommunities([])
      setLoadError(null)
      setLoading(false)
      return
    }

    if (showLoading) setLoading(true)
    setLoadError(null)
    try {
      const catalog = await listUsers()
      setUsers(catalog.users)
      setCommunities(catalog.communities)
    } catch (error) {
      setLoadError(error.message)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [canManageUsers, profile?.id])

  useEffect(() => {
    // The Edge Function is the external source for this administration view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshUsers()
  }, [refreshUsers])

  useEffect(() => {
    const refreshWhenReturning = () => {
      refreshUsers({ showLoading: false })
    }

    window.addEventListener('focus', refreshWhenReturning)
    return () => window.removeEventListener('focus', refreshWhenReturning)
  }, [refreshUsers])

  // Summary always reflects every user, not the current filter.
  const stats = useMemo(
    () => [
      {
        label: 'Active Users',
        value: users.filter((user) => user.accountStatus === 'ACTIVE').length,
        icon: GroupRoundedIcon,
        color: 'success',
      },
      {
        label: 'Pending Invitations',
        value: users.filter((user) => user.accountStatus === 'PENDING_INVITE').length,
        icon: PendingActionsRoundedIcon,
        color: 'warning',
      },
      {
        label: 'Never Signed In',
        value: users.filter((user) => user.accountStatus === 'NEVER_SIGNED_IN').length,
        icon: CheckCircleOutlineRoundedIcon,
        color: 'info',
      },
      {
        label: 'Inactive',
        value: users.filter((user) => user.accountStatus === 'INACTIVE').length,
        icon: PersonOffRoundedIcon,
        color: 'error',
      },
    ],
    [users],
  )

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase()

    return users.filter((user) => {
      const matchesSearch =
        !query ||
        [user.name, user.email, user.phone]
          .join(' ')
          .toLowerCase()
          .includes(query)
      const matchesRole = roleFilter === 'all' || user.role === roleFilter
      const matchesStatus = statusFilter === 'all'
        || user.accountStatus === statusFilter

      return matchesSearch && matchesRole && matchesStatus
    })
  }, [users, search, roleFilter, statusFilter])

  const visibleUsers = filteredUsers.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  const handleMenuOpen = (event, user) => {
    setMenuAnchor(event.currentTarget)
    setSelectedUser(user)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setSelectedUser(null)
  }

  const openEditDialog = () => {
    setDialogState({ mode: 'edit', user: selectedUser })
    handleMenuClose()
  }

  const openStatusDialog = () => {
    setStatusTarget(selectedUser)
    handleMenuClose()
  }

  const openResendDialog = () => {
    setResendTarget(selectedUser)
    handleMenuClose()
  }

  const handleSave = async (form) => {
    setSaving(true)
    try {
      if (dialogState?.mode === 'edit') {
        const updated = await updateUser(dialogState.user.id, form)
        setUsers((current) => current.map((user) => (
          user.id === updated.id ? updated : user
        )))
        if (updated.id === profile.id) await refreshProfile()
        setNotice({ severity: 'success', message: 'User updated.' })
      } else {
        const invited = await inviteUser(form)
        setUsers((current) => [invited, ...current])
        setPage(0)
        setNotice({
          severity: 'success',
          message: `Invitation sent to ${invited.email}.`,
        })
      }

      setDialogState(null)
    } catch (error) {
      setNotice({ severity: 'error', message: error.message })
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async () => {
    if (!statusTarget) return

    setSaving(true)
    try {
      const updated = await setUserActive(statusTarget.id, !statusTarget.isActive)
      setUsers((current) => current.map((user) => (
        user.id === updated.id ? updated : user
      )))
      setStatusTarget(null)
      setNotice({
        severity: 'success',
        message: updated.isActive ? 'User reactivated.' : 'User deactivated.',
      })
      if (updated.id === profile.id) await refreshProfile()
    } catch (error) {
      setNotice({ severity: 'error', message: error.message })
    } finally {
      setSaving(false)
    }
  }

  const handleResendInvitation = async () => {
    if (!resendTarget) return

    setSaving(true)
    try {
      const updated = await resendInvitation(resendTarget.id)
      setUsers((current) => current.map((user) => (
        user.id === updated.id ? updated : user
      )))
      setResendTarget(null)
      setNotice({
        severity: 'success',
        message: `Invitation resent to ${updated.email}.`,
      })
    } catch (error) {
      setNotice({ severity: 'error', message: error.message })
    } finally {
      setSaving(false)
    }
  }

  if (!canManageUsers) {
    return (
      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <Alert severity="error">Only an administrator can manage users.</Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 3,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 2,
          flexDirection: { xs: 'column', sm: 'row' },
        }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700} color="text.primary">
            Users &amp; Roles
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage who can sign in and what each person is allowed to do.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            disabled={loading || saving}
            onClick={() => refreshUsers()}
          >
            Refresh
          </Button>
          <ResponsiveCreateButton
            label="Invite user"
            disabled={loading || saving}
            onClick={() => setDialogState({ mode: 'create' })}
          />
        </Stack>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {loadError && (
          <Alert
            severity="error"
            action={(
              <Button color="inherit" size="small" onClick={refreshUsers}>
                Retry
              </Button>
            )}
            sx={{ mb: 2.5 }}
          >
            {loadError}
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
          {stats.map((stat) => (
            <StatTile key={stat.label} {...stat} />
          ))}
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
            direction={{ xs: 'column', md: 'row' }}
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
              placeholder="Search users by name, email or phone..."
              sx={{ width: { xs: '100%', md: 380 } }}
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
            <FormControl size="small" sx={{ minWidth: 230 }}>
              <InputLabel id="user-role-filter-label">Role</InputLabel>
              <Select
                labelId="user-role-filter-label"
                label="Role"
                value={roleFilter}
                onChange={(event) => {
                  setRoleFilter(event.target.value)
                  setPage(0)
                }}
                startAdornment={
                  <InputAdornment position="start">
                    <FilterListRoundedIcon fontSize="small" color="action" />
                  </InputAdornment>
                }
              >
                <MenuItem value="all">All roles</MenuItem>
                {userRoleOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 210 }}>
              <InputLabel id="user-status-filter-label">Status</InputLabel>
              <Select
                labelId="user-status-filter-label"
                label="Status"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value)
                  setPage(0)
                }}
              >
                <MenuItem value="all">All statuses</MenuItem>
                {userStatusOptions.map((status) => (
                  <MenuItem key={status.value} value={status.value}>
                    {status.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <TableContainer>
            <Table sx={{ minWidth: 1250 }}>
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
                  <TableCell>User</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Phone number</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Last password login</TableCell>
                  <TableCell align="right" width={72}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ py: 8, textAlign: 'center' }}>
                      <CircularProgress size={32} aria-label="Loading users" />
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                        Loading users…
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && visibleUsers.map((user) => (
                  <TableRow
                    key={user.id}
                    hover
                    sx={{ '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <Avatar
                          sx={{
                            width: 38,
                            height: 38,
                            bgcolor: 'primary.light',
                            color: 'primary.main',
                            fontSize: 13,
                            fontWeight: 700,
                            opacity: user.isActive ? 1 : 0.5,
                          }}
                        >
                          {getInitials(user.name)}
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                            <Typography variant="body2" fontWeight={600} noWrap>
                              {user.name}
                            </Typography>
                          </Stack>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            component="div"
                          >
                            {user.email}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <UserStatusChip status={user.accountStatus} />
                      {user.accountStatus === 'PENDING_INVITE'
                        && user.confirmationSentAt && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="div"
                          noWrap
                          sx={{ mt: 0.5 }}
                        >
                          Sent {formatDateTime(user.confirmationSentAt)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 340 }}>
                      <Chip
                        label={userRoleLabels[user.role]}
                        size="small"
                        variant="outlined"
                        color={user.role === 'ADMIN' ? 'primary' : 'default'}
                      />
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                        noWrap
                        sx={{ mt: 0.5 }}
                      >
                        {isScopedRole(user.role) && !user.allProjects
                          ? user.projectAccess
                              .map((project) => projectLabels[project] ?? project)
                              .join(', ')
                          : 'All projects'}
                        </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {user.phone ? formatPhoneNumber(user.phone) : 'No phone'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {formatDateTime(user.createdAt)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {formatDateTime(user.lastPasswordLoginAt, 'Never')}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        aria-label={`Actions for ${user.name}`}
                        onClick={(event) => handleMenuOpen(event, user)}
                      >
                        <MoreHorizRoundedIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}

                {!loading && !loadError && visibleUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ py: 8, textAlign: 'center' }}>
                      <SearchRoundedIcon color="action" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography fontWeight={600}>No users found</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Try changing your search, role or status filter.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={filteredUsers.length}
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

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={openEditDialog}>
          <EditOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Edit
        </MenuItem>
        {selectedUser?.accountStatus === 'PENDING_INVITE' && (
          <MenuItem onClick={openResendDialog}>
            <MailOutlineRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
            Resend invitation
          </MenuItem>
        )}
        <MenuItem
          onClick={openStatusDialog}
          sx={{ color: selectedUser?.isActive ? 'error.main' : 'success.main' }}
        >
          {selectedUser?.isActive
            ? <PersonOffRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
            : <CheckCircleOutlineRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />}
          {selectedUser?.isActive ? 'Deactivate' : 'Reactivate'}
        </MenuItem>
      </Menu>

      {dialogState && (
        <UserDialog
          key={dialogState.user?.id ?? 'new'}
          communities={communities}
          saving={saving}
          user={dialogState.user}
          users={users}
          onClose={() => setDialogState(null)}
          onSave={handleSave}
        />
      )}

      <Dialog
        open={Boolean(statusTarget)}
        onClose={() => !saving && setStatusTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {statusTarget?.isActive ? 'Deactivate user?' : 'Reactivate user?'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {statusTarget
              ? statusTarget.isActive
                ? `${statusTarget.name} will lose access but keep their history.`
                : `${statusTarget.name} will be allowed to sign in again.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setStatusTarget(null)} disabled={saving}>
            Cancel
          </Button>
          <Button
            color={statusTarget?.isActive ? 'error' : 'success'}
            variant="contained"
            onClick={handleStatusChange}
            disabled={saving}
            disableElevation
          >
            {saving
              ? 'Saving…'
              : statusTarget?.isActive
                ? 'Deactivate user'
                : 'Reactivate user'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(resendTarget)}
        onClose={() => !saving && setResendTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Resend invitation?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {resendTarget
              ? `A new invitation email will be sent to ${resendTarget.email}. The user should use the newest link.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setResendTarget(null)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleResendInvitation}
            disabled={saving}
            disableElevation
          >
            {saving ? 'Sending…' : 'Resend invitation'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={notice?.severity ?? 'success'}
          onClose={() => setNotice(null)}
          variant="filled"
        >
          {notice?.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
