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
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
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
  builderLabels,
  builderOptions,
  contactTypeDescriptions,
  contactTypeLabels,
  contactTypeOptions,
  emptyContact,
} from '../data/builderContacts.js'
import { useBuilderContacts } from '../context/useBuilderContacts.js'
import { createBuilderContactSchema } from '../schemas/builderContactSchema.js'

function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function getContactFormValues(contact) {
  if (!contact) {
    return {
      ...emptyContact,
      phoneCountry: 'US',
      officePhoneCountry: 'US',
    }
  }

  const phoneCountry = getPhoneCountry(contact.phone)
  const officePhoneCountry = getPhoneCountry(contact.officePhone)
  return {
    ...contact,
    phoneCountry,
    phone: getNationalPhoneNumber(contact.phone, phoneCountry),
    officePhoneCountry,
    officePhone: getNationalPhoneNumber(contact.officePhone, officePhoneCountry),
  }
}

function ContactDialog({ contact, contacts, onClose, onSave }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createBuilderContactSchema(contacts, contact?.id ?? null)),
    defaultValues: getContactFormValues(contact),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

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
          {contact ? 'Edit contact' : 'New contact'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {contact
            ? 'Update who to reach on the builder side.'
            : 'Add someone who works for the builder, not for Valtrim.'}
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

          <Controller
            name="builder"
            control={control}
            render={({ field }) => (
              <FormControl error={Boolean(errors.builder)} fullWidth>
                <InputLabel id="contact-builder-label">Builder</InputLabel>
                <Select
                  labelId="contact-builder-label"
                  label="Builder"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                >
                  {builderOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{errors.builder?.message ?? ' '}</FormHelperText>
              </FormControl>
            )}
          />

          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <FormControl error={Boolean(errors.type)} fullWidth>
                <InputLabel id="contact-type-label">Contact type</InputLabel>
                <Select
                  labelId="contact-type-label"
                  label="Contact type"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                >
                  {contactTypeOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  {errors.type?.message ?? contactTypeDescriptions[field.value]}
                </FormHelperText>
              </FormControl>
            )}
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
            label="Notes"
            {...register('notes')}
            error={Boolean(errors.notes)}
            helperText={errors.notes?.message ?? 'How they prefer to be reached, quirks to remember'}
            fullWidth
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disableElevation>
          {contact ? 'Save changes' : 'Create contact'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function BuilderContactsCatalog() {
  const { contacts, setContacts } = useBuilderContacts()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [builderFilter, setBuilderFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedContact, setSelectedContact] = useState(null)
  const [dialogState, setDialogState] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [notice, setNotice] = useState(null)

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase()

    return contacts.filter((contact) => {
      const matchesSearch =
        !query ||
        [contact.name, contact.email, contact.phone, contact.officePhone, builderLabels[contact.builder]]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)
      const matchesType = typeFilter === 'all' || contact.type === typeFilter
      const matchesBuilder =
        builderFilter === 'all' || contact.builder === builderFilter

      return matchesSearch && matchesType && matchesBuilder
    })
  }, [contacts, search, typeFilter, builderFilter])

  const visibleContacts = filteredContacts.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  const handleMenuOpen = (event, contact) => {
    setMenuAnchor(event.currentTarget)
    setSelectedContact(contact)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setSelectedContact(null)
  }

  const openEditDialog = () => {
    setDialogState({ mode: 'edit', contact: selectedContact })
    handleMenuClose()
  }

  const openDeleteDialog = () => {
    setDeleteTarget(selectedContact)
    handleMenuClose()
  }

  const handleSave = (form) => {
    if (dialogState?.mode === 'edit') {
      setContacts((current) =>
        current.map((contact) =>
          contact.id === dialogState.contact.id ? { ...contact, ...form } : contact,
        ),
      )
      setNotice({ severity: 'success', message: 'Contact updated.' })
    } else {
      setContacts((current) => [{ ...form, id: Date.now() }, ...current])
      setPage(0)
      setNotice({ severity: 'success', message: 'Contact created.' })
    }

    setDialogState(null)
  }

  const handleDelete = () => {
    setContacts((current) =>
      current.filter((contact) => contact.id !== deleteTarget.id),
    )
    setDeleteTarget(null)
    setPage(0)
    setNotice({ severity: 'success', message: 'Contact deleted.' })
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
            Builder Contacts
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Superintendents and accounts payable contacts on the builder side.
          </Typography>
        </Box>
        <ResponsiveCreateButton
          label="New contact"
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
              placeholder="Search contacts, builders or phone numbers..."
              sx={{ width: { xs: '100%', md: 340 } }}
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
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="contact-builder-filter-label">Builder</InputLabel>
              <Select
                labelId="contact-builder-filter-label"
                label="Builder"
                value={builderFilter}
                onChange={(event) => {
                  setBuilderFilter(event.target.value)
                  setPage(0)
                }}
                startAdornment={
                  <InputAdornment position="start">
                    <FilterListRoundedIcon fontSize="small" color="action" />
                  </InputAdornment>
                }
              >
                <MenuItem value="all">All builders</MenuItem>
                {builderOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 210 }}>
              <InputLabel id="contact-type-filter-label">Contact type</InputLabel>
              <Select
                labelId="contact-type-filter-label"
                label="Contact type"
                value={typeFilter}
                onChange={(event) => {
                  setTypeFilter(event.target.value)
                  setPage(0)
                }}
              >
                <MenuItem value="all">All types</MenuItem>
                {contactTypeOptions.map((option) => (
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
                  <TableCell>Contact</TableCell>
                  <TableCell>Builder</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell align="right" width={72}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleContacts.map((contact) => (
                  <TableRow
                    key={contact.id}
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
                          {getInitials(contact.name)}
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {contact.name}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            component="div"
                          >
                            {contact.email}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {builderLabels[contact.builder] ?? contact.builder}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={contactTypeLabels[contact.type]}
                        size="small"
                        variant="outlined"
                        color={contact.type === 'AP_CONTACT' ? 'primary' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {contact.phone
                          ? formatPhoneNumber(contact.phone)
                          : contact.officePhone
                            ? formatPhoneNumber(contact.officePhone)
                            : 'No phone'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        aria-label={`Actions for ${contact.name}`}
                        onClick={(event) => handleMenuOpen(event, contact)}
                      >
                        <MoreHorizRoundedIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}

                {visibleContacts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center' }}>
                      <SearchRoundedIcon color="action" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography fontWeight={600}>No contacts found</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Try changing your search, builder or type filter.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={filteredContacts.length}
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
        <ContactDialog
          key={dialogState.contact?.id ?? 'new'}
          contact={dialogState.contact}
          contacts={contacts}
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
        <DialogTitle>Delete contact?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deleteTarget
              ? `${deleteTarget.name} will be removed from the ${builderLabels[deleteTarget.builder]} contact list.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disableElevation>
            Delete contact
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
