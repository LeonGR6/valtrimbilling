import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
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
import ContactPhoneRoundedIcon from '@mui/icons-material/ContactPhoneRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import {
  emptyPerson,
  initialPeople,
  personTypeLabels,
  personTypeOptions,
} from '../data/people.js'
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

function PersonDialog({ person, onClose, onSave }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(personSchema),
    defaultValues: person
      ? {
          name: person.name,
          phone: person.phone,
          officePhone: person.officePhone,
          email: person.email,
          types: [...person.types],
          territory: person.territory ?? '',
        }
      : { ...emptyPerson },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const selectedTypes = useWatch({ control, name: 'types' }) ?? []

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
          {person ? 'Edit person' : 'New person'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {person
            ? 'Update the contact information and person types.'
            : 'Add a person who can be assigned to jobs later.'}
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

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
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
            <TextField
              label="Office phone number"
              type="tel"
              {...register('officePhone')}
              error={Boolean(errors.officePhone)}
              helperText={errors.officePhone?.message ?? 'Optional'}
              fullWidth
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <ContactPhoneRoundedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
                htmlInput: { maxLength: 30 },
              }}
            />
          </Stack>

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

          <Controller
            name="types"
            control={control}
            render={({ field }) => (
              <FormControl error={Boolean(errors.types)}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                  Person type
                </Typography>
                <FormGroup
                  onBlur={field.onBlur}
                  sx={{
                    border: 1,
                    borderColor: errors.types ? 'error.main' : 'divider',
                    borderRadius: 2,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  {personTypeOptions.map((option) => (
                    <FormControlLabel
                      key={option.value}
                      label={option.label}
                      control={
                        <Checkbox
                          checked={field.value.includes(option.value)}
                          onChange={(_, checked) => {
                            const nextValue = checked
                              ? [...field.value, option.value]
                              : field.value.filter((value) => value !== option.value)
                            field.onChange(nextValue)
                          }}
                        />
                      }
                    />
                  ))}
                </FormGroup>
                <FormHelperText>
                  {errors.types?.message ?? 'Select every type that applies.'}
                </FormHelperText>
              </FormControl>
            )}
          />

          {selectedTypes.includes('SUPERVISOR') && (
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
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disableElevation>
          {person ? 'Save changes' : 'Create person'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function PeopleCatalog() {
  const [people, setPeople] = useState(initialPeople)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [dialogState, setDialogState] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
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
      const matchesType =
        typeFilter === 'all' || person.types.includes(typeFilter)

      return matchesSearch && matchesType
    })
  }, [people, search, typeFilter])

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

  const openDeleteDialog = () => {
    setDeleteTarget(selectedPerson)
    handleMenuClose()
  }

  const handleSave = (form) => {
    if (dialogState?.mode === 'edit') {
      setPeople((current) =>
        current.map((person) =>
          person.id === dialogState.person.id ? { ...person, ...form } : person,
        ),
      )
      setNotice({ severity: 'success', message: 'Person updated.' })
    } else {
      setPeople((current) => [{ ...form, id: Date.now() }, ...current])
      setPage(0)
      setNotice({ severity: 'success', message: 'Person created.' })
    }

    setDialogState(null)
  }

  const handleDelete = () => {
    setPeople((current) =>
      current.filter((person) => person.id !== deleteTarget.id),
    )
    setDeleteTarget(null)
    setPage(0)
    setNotice({ severity: 'success', message: 'Person deleted.' })
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
            People
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage the contacts and team members available for job assignments.
          </Typography>
        </Box>
        <ResponsiveCreateButton
          label="New person"
          onClick={() => setDialogState({ mode: 'create' })}
        />
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
              placeholder="Search people or contact information..."
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
              <InputLabel id="person-type-filter-label">Person type</InputLabel>
              <Select
                labelId="person-type-filter-label"
                label="Person type"
                value={typeFilter}
                onChange={(event) => {
                  setTypeFilter(event.target.value)
                  setPage(0)
                }}
                startAdornment={
                  <InputAdornment position="start">
                    <FilterListRoundedIcon fontSize="small" color="action" />
                  </InputAdornment>
                }
              >
                <MenuItem value="all">All person types</MenuItem>
                {personTypeOptions.map((option) => (
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
                  <TableCell>Person</TableCell>
                  <TableCell>Phone number</TableCell>
                  <TableCell>Office phone number</TableCell>
                  <TableCell>Person type</TableCell>
                  <TableCell>Territory</TableCell>
                  <TableCell align="right" width={72}>Actions</TableCell>
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
                        {person.phone || 'No phone'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {person.officePhone || 'No office phone'}
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
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        aria-label={`Actions for ${person.name}`}
                        onClick={(event) => handleMenuOpen(event, person)}
                      >
                        <MoreHorizRoundedIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}

                {visiblePeople.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ py: 8, textAlign: 'center' }}>
                      <SearchRoundedIcon color="action" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography fontWeight={600}>No people found</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Try changing your search or person type filter.
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
        <MenuItem onClick={openDeleteDialog} sx={{ color: 'error.main' }}>
          <DeleteOutlineRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Delete
        </MenuItem>
      </Menu>

      {dialogState && (
        <PersonDialog
          key={dialogState.person?.id ?? 'new'}
          person={dialogState.person}
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
        <DialogTitle>Delete person?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deleteTarget
              ? `${deleteTarget.name} will be removed from the people catalog.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disableElevation>
            Delete person
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
