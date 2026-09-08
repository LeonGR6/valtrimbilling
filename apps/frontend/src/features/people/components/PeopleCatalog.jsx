import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Switch,
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
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import {
  formatPhoneNumber,
  getNationalPhoneNumber,
  getPhoneCountry,
} from '../../../utils/phoneNumbers.js'
import {
  emptyPerson,
  personTypeLabels,
} from '../data/people.js'
import { usePeople } from '../context/usePeople.js'
import { personSchema } from '../schemas/personSchema.js'

function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function getPersonFormValues(person) {
  if (!person) {
    return {
      ...emptyPerson,
      phoneCountry: 'US',
      officePhoneCountry: 'US',
    }
  }

  const phoneCountry = getPhoneCountry(person.phone)
  const officePhoneCountry = getPhoneCountry(person.officePhone)
  return {
    ...person,
    phoneCountry,
    phone: getNationalPhoneNumber(person.phone, phoneCountry),
    officePhoneCountry,
    officePhone: getNationalPhoneNumber(person.officePhone, officePhoneCountry),
  }
}

function PersonDialog({ person, onClose, onSave, submitting }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(personSchema),
    defaultValues: getPersonFormValues(person),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {person ? 'Edit supervisor' : 'New supervisor'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {person
            ? 'Update the supervisor contact information and territory.'
            : 'Add a Valtrim supervisor who can be assigned to jobs.'}
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

          <FormPhoneInput
            control={control}
            name="phone"
            label="Phone number"
            error={errors.phone}
            helperText="Optional · choose +1 or +52"
          />
          <FormPhoneInput
            control={control}
            name="officePhone"
            label="Office phone number"
            error={errors.officePhone}
            helperText="Optional · choose +1 or +52"
          />

          <TextField
            label="Email"
            type="email"
            {...register('email')}
            error={Boolean(errors.email)}
            helperText={errors.email?.message ?? ' '}
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
            label="Territory"
            {...register('territory')}
            error={Boolean(errors.territory)}
            helperText={
              errors.territory?.message
              ?? 'Geographic area assigned to this Valtrim supervisor.'
            }
            required
            fullWidth
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />

          {person && (
            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                px: 2,
                py: 1,
              }}
            >
              <FormControlLabel
                sx={{ m: 0, width: '100%', justifyContent: 'space-between' }}
                labelPlacement="start"
                control={(
                  <Controller
                    name="isActive"
                    control={control}
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onChange={(_, checked) => field.onChange(checked)}
                        slotProps={{ input: { ref: field.ref } }}
                      />
                    )}
                  />
                )}
                label={(
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      Active supervisor
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Inactive supervisors remain visible in the roster.
                    </Typography>
                  </Box>
                )}
              />
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={submitting} disableElevation>
          {submitting
            ? 'Saving...'
            : person ? 'Save changes' : 'Create supervisor'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function PeopleCatalog() {
  const {
    people,
    loading,
    error,
    canManageSupervisors,
    refreshPeople,
    createSupervisor,
    updateSupervisor,
    deactivateSupervisor,
  } = usePeople()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [dialogState, setDialogState] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)

  const filteredPeople = useMemo(() => {
    const query = search.trim().toLowerCase()

    return people.filter((person) => {
      const matchesSearch =
        !query ||
        [person.name, person.phone, person.officePhone, person.email, person.territory]
          .join(' ')
          .toLowerCase()
          .includes(query)
      const matchesStatus =
        status === 'all' ||
        (status === 'active' ? person.isActive : !person.isActive)

      return matchesSearch && matchesStatus
    })
  }, [people, search, status])

  const visiblePeople = filteredPeople.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  const handleMenuOpen = (event, person) => {
    setMenuAnchor(event.currentTarget)
    setSelectedPerson(person)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setSelectedPerson(null)
  }

  const openEditDialog = () => {
    setDialogState({ mode: 'edit', person: selectedPerson })
    handleMenuClose()
  }

  const openDeactivateDialog = () => {
    setDeactivateTarget(selectedPerson)
    handleMenuClose()
  }

  const handleSave = async (form) => {
    setSubmitting(true)
    try {
      if (dialogState?.mode === 'edit') {
        await updateSupervisor(dialogState.person.id, form)
        setNotice({ severity: 'success', message: 'Supervisor updated.' })
      } else {
        await createSupervisor(form)
        setPage(0)
        setNotice({ severity: 'success', message: 'Supervisor created.' })
      }

      setDialogState(null)
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeactivate = async () => {
    setSubmitting(true)
    try {
      await deactivateSupervisor(deactivateTarget.id)
      setDeactivateTarget(null)
      setPage(0)
      setNotice({ severity: 'success', message: 'Supervisor deactivated.' })
    } catch (deactivateError) {
      setNotice({ severity: 'error', message: deactivateError.message })
    } finally {
      setSubmitting(false)
    }
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
            Crews &amp; Foremen
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage Valtrim supervisors available for job assignments.
          </Typography>
        </Box>
        {canManageSupervisors && (
          <ResponsiveCreateButton
            label="New supervisor"
            onClick={() => setDialogState({ mode: 'create' })}
          />
        )}
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
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
              placeholder="Search supervisors or contact information..."
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
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="supervisor-status-filter-label">Status</InputLabel>
              <Select
                labelId="supervisor-status-filter-label"
                label="Status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value)
                  setPage(0)
                }}
                startAdornment={(
                  <InputAdornment position="start">
                    <FilterListRoundedIcon fontSize="small" color="action" />
                  </InputAdornment>
                )}
              >
                <MenuItem value="all">All supervisors</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="inactive">Inactive</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          {error && (
            <Alert
              severity="error"
              action={(
                <Button color="inherit" size="small" onClick={() => refreshPeople().catch(() => {})}>
                  Retry
                </Button>
              )}
              sx={{ borderRadius: 0 }}
            >
              {error}
            </Alert>
          )}

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
                  <TableCell>Person</TableCell>
                  <TableCell>Phone number</TableCell>
                  <TableCell>Office phone number</TableCell>
                  <TableCell>Person type</TableCell>
                  <TableCell>Territory</TableCell>
                  <TableCell>Status</TableCell>
                  {canManageSupervisors && (
                    <TableCell align="right" width={72}>Actions</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {visiblePeople.map((person) => (
                  <TableRow
                    key={person.id}
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
                          }}
                        >
                          {getInitials(person.name)}
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {person.name}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            component="div"
                          >
                            {person.email}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {person.phone ? formatPhoneNumber(person.phone) : 'No phone'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {person.officePhone ? formatPhoneNumber(person.officePhone) : 'No office phone'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 340 }}>
                      <Stack
                        direction="row"
                        spacing={0.75}
                        useFlexGap
                        sx={{ flexWrap: 'wrap' }}
                      >
                        {person.types.map((type) => (
                          <Chip
                            key={type}
                            label={personTypeLabels[type]}
                            size="small"
                            variant="outlined"
                            color={type === 'SUPERVISOR' ? 'primary' : 'default'}
                          />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {person.types.includes('SUPERVISOR')
                          ? person.territory || 'Not assigned'
                          : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={person.isActive ? 'Active' : 'Inactive'}
                        size="small"
                        color={person.isActive ? 'success' : 'default'}
                        variant={person.isActive ? 'filled' : 'outlined'}
                        sx={{
                          fontWeight: 600,
                          ...(person.isActive && {
                            bgcolor: 'success.light',
                            color: 'success.dark',
                          }),
                        }}
                      />
                    </TableCell>
                    {canManageSupervisors && (
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          aria-label={`Actions for ${person.name}`}
                          onClick={(event) => handleMenuOpen(event, person)}
                        >
                          <MoreHorizRoundedIcon />
                        </IconButton>
                      </TableCell>
                    )}
                  </TableRow>
                ))}

                {loading && visiblePeople.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6 + Number(canManageSupervisors)}
                      sx={{ py: 8, textAlign: 'center' }}
                    >
                      <Typography color="text.secondary">Loading supervisors...</Typography>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && visiblePeople.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6 + Number(canManageSupervisors)}
                      sx={{ py: 8, textAlign: 'center' }}
                    >
                      <SearchRoundedIcon color="action" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography fontWeight={600}>No supervisors found</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {people.length === 0
                          ? 'Create the first supervisor to start the roster.'
                          : 'Try changing your search or status filter.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={filteredPeople.length}
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
        <MenuItem
          onClick={openDeactivateDialog}
          disabled={!selectedPerson?.isActive}
          sx={{ color: 'error.main' }}
        >
          <BlockRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Deactivate
        </MenuItem>
      </Menu>

      {dialogState && (
        <PersonDialog
          key={dialogState.person?.id ?? 'new'}
          person={dialogState.person}
          onClose={() => setDialogState(null)}
          onSave={handleSave}
          submitting={submitting}
        />
      )}

      <Dialog
        open={Boolean(deactivateTarget)}
        onClose={submitting ? undefined : () => setDeactivateTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Deactivate supervisor?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deactivateTarget
              ? `${deactivateTarget.name} will remain in the roster as inactive.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            color="inherit"
            onClick={() => setDeactivateTarget(null)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeactivate}
            disabled={submitting}
            disableElevation
          >
            {submitting ? 'Deactivating...' : 'Deactivate supervisor'}
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
