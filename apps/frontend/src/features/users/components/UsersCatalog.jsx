import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
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
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import GroupRoundedIcon from '@mui/icons-material/GroupRounded'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import PendingActionsRoundedIcon from '@mui/icons-material/PendingActionsRounded'
import PersonOffRoundedIcon from '@mui/icons-material/PersonOffRounded'
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import {
  emptyUser,
  initialUsers,
  isScopedRole,
  projectLabels,
  projectOptions,
  userRoleDescriptions,
  userRoleLabels,
  userRoleOptions,
} from '../data/users.js'
import { createUserSchema } from '../schemas/userSchema.js'

function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
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

function UserDialog({ user, users, onClose, onSave }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createUserSchema(users, user?.id ?? null)),
    defaultValues: user
      ? {
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          allProjects: user.allProjects,
          projectAccess: [...user.projectAccess],
          isActive: user.isActive,
        }
      : { ...emptyUser },
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
            : 'Add a user who can sign in to the application.'}
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

          <TextField
            label="Phone number"
            type="tel"
            {...register('phone')}
            error={Boolean(errors.phone)}
            helperText={errors.phone?.message ?? 'Optional'}
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <PhoneOutlinedIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: { maxLength: 30 },
            }}
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
                  options={projectOptions.map((option) => option.value)}
                  getOptionLabel={(option) => projectLabels[option] ?? option}
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
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disableElevation>
          {user ? 'Save changes' : 'Create user'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function UsersCatalog() {
  const [users, setUsers] = useState(initialUsers)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [dialogState, setDialogState] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [notice, setNotice] = useState(null)

  // Summary always reflects every user, not the current filter.
  const stats = useMemo(
    () => [
      {
        label: 'Active Users',
        value: users.filter((user) => user.isActive).length,
        icon: GroupRoundedIcon,
        color: 'primary',
      },
      {
        label: 'Never Signed In',
        value: users.filter((user) => !user.lastLoginAt).length,
        icon: PendingActionsRoundedIcon,
        color: 'warning',
      },
      {
        label: 'Admins',
        value: users.filter((user) => user.role === 'ADMIN').length,
        icon: AdminPanelSettingsRoundedIcon,
        color: 'success',
      },
      {
        label: 'Inactive',
        value: users.filter((user) => !user.isActive).length,
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

      return matchesSearch && matchesRole
    })
  }, [users, search, roleFilter])

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

  const openDeleteDialog = () => {
    setDeleteTarget(selectedUser)
    handleMenuClose()
  }

  const handleSave = (form) => {
    if (dialogState?.mode === 'edit') {
      setUsers((current) =>
        current.map((user) =>
          user.id === dialogState.user.id ? { ...user, ...form } : user,
        ),
      )
      setNotice({ severity: 'success', message: 'User updated.' })
    } else {
      setUsers((current) => [
        { ...form, id: Date.now(), lastLoginAt: null },
        ...current,
      ])
      setPage(0)
      setNotice({ severity: 'success', message: 'User created.' })
    }

    setDialogState(null)
  }

  const handleDelete = () => {
    setUsers((current) => current.filter((user) => user.id !== deleteTarget.id))
    setDeleteTarget(null)
    setPage(0)
    setNotice({ severity: 'success', message: 'User deleted.' })
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
        <ResponsiveCreateButton
          label="New user"
          onClick={() => setDialogState({ mode: 'create' })}
        />
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
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
          </Stack>

          <TableContainer>
            <Table sx={{ minWidth: 900 }}>
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
                  <TableCell>Phone number</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell align="right" width={72}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleUsers.map((user) => (
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
                            {!user.isActive && (
                              <Chip label="Inactive" size="small" variant="outlined" />
                            )}
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
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {user.phone || 'No phone'}
                      </Typography>
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

                {visibleUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} sx={{ py: 8, textAlign: 'center' }}>
                      <SearchRoundedIcon color="action" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography fontWeight={600}>No users found</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Try changing your search or role filter.
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
        <MenuItem onClick={openDeleteDialog} sx={{ color: 'error.main' }}>
          <DeleteOutlineRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Delete
        </MenuItem>
      </Menu>

      {dialogState && (
        <UserDialog
          key={dialogState.user?.id ?? 'new'}
          user={dialogState.user}
          users={users}
          onClose={() => setDialogState(null)}
          onSave={handleSave}
        />
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Delete user?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deleteTarget
              ? `${deleteTarget.name} will lose access to the application.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disableElevation>
            Delete user
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
