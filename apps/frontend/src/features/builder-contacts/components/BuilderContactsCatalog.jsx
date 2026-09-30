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
  FormHelperText,
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
  contactTypeDescriptions,
  contactTypeLabels,
  contactTypeOptions,
  emptyContact,
} from '../data/builderContacts.js'
import { useBuilders } from '../../builders/context/useBuilders.js'
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

function ContactDialog({ contact, contacts, builders, onClose, onSave, submitting }) {
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
      onClose={submitting ? undefined : onClose}
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
            name="builderId"
            control={control}
            render={({ field }) => (
              <FormControl error={Boolean(errors.builderId)} fullWidth>
                <InputLabel id="contact-builder-label">Builder</InputLabel>
                <Select
                  labelId="contact-builder-label"
                  label="Builder"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                >
                  {builders.map((builder) => (
                    <MenuItem key={builder.id} value={builder.id}>
                      {builder.name} ({builder.code})
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{errors.builderId?.message ?? ' '}</FormHelperText>
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

          {contact && (
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
                      Active contact
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Inactive contacts remain visible in the catalog.
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
          {submitting ? 'Saving...' : contact ? 'Save changes' : 'Create contact'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function BuilderContactsCatalog() {
  const {
    contacts,
    loading: contactsLoading,
    error: contactsError,
    canManageBuilderContacts,
    refreshBuilderContacts,
    createBuilderContact,
    updateBuilderContact,
    deactivateBuilderContact,
  } = useBuilderContacts()
  const {
    builders,
    loading: buildersLoading,
    error: buildersError,
    refreshBuilders,
  } = useBuilders()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [builderFilter, setBuilderFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedContact, setSelectedContact] = useState(null)
  const [dialogState, setDialogState] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)
  const buildersById = useMemo(
    () => new Map(builders.map((builder) => [builder.id, builder])),
    [builders],
  )

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase()

    return contacts.filter((contact) => {
      const matchesSearch =
        !query ||
        [
          contact.name,
          contact.email,
          contact.phone,
          contact.officePhone,
          buildersById.get(contact.builderId)?.name,
          buildersById.get(contact.builderId)?.code,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)
      const matchesType = typeFilter === 'all' || contact.type === typeFilter
      const matchesBuilder =
        builderFilter === 'all' || contact.builderId === Number(builderFilter)
      const matchesStatus =
        statusFilter === 'all'
        || (statusFilter === 'active' ? contact.isActive : !contact.isActive)

      return matchesSearch && matchesType && matchesBuilder && matchesStatus
    })
  }, [builderFilter, buildersById, contacts, search, statusFilter, typeFilter])

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

  const openDeactivateDialog = () => {
    setDeactivateTarget(selectedContact)
    handleMenuClose()
  }

  const handleSave = async (form) => {
    setSubmitting(true)
    try {
      if (dialogState?.mode === 'edit') {
        await updateBuilderContact(dialogState.contact.id, form)
        setNotice({ severity: 'success', message: 'Contact updated.' })
      } else {
        await createBuilderContact(form)
        setPage(0)
        setNotice({ severity: 'success', message: 'Contact created.' })
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
      await deactivateBuilderContact(deactivateTarget.id)
      setDeactivateTarget(null)
      setPage(0)
      setNotice({ severity: 'success', message: 'Contact deactivated.' })
    } catch (deactivateError) {
      setNotice({ severity: 'error', message: deactivateError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const dialogBuilders = builders.filter(
    (builder) => builder.isActive || builder.id === dialogState?.contact?.builderId,
  )
  const loading = contactsLoading || buildersLoading
  const loadError = contactsError || buildersError

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
        {canManageBuilderContacts && (
          <ResponsiveCreateButton
            label="New contact"
            disabled={buildersLoading || builders.length === 0}
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
                {builders.map((builder) => (
                  <MenuItem key={builder.id} value={String(builder.id)}>
                    {builder.name}
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
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="contact-status-filter-label">Status</InputLabel>
              <Select
                labelId="contact-status-filter-label"
                label="Status"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value)
                  setPage(0)
                }}
              >
                <MenuItem value="all">All contacts</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="inactive">Inactive</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          {loadError && (
            <Alert
              severity="error"
              action={(
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => {
                    refreshBuilderContacts().catch(() => {})
                    refreshBuilders().catch(() => {})
                  }}
                >
                  Retry
                </Button>
              )}
              sx={{ borderRadius: 0 }}
            >
              {loadError}
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
                  <TableCell>Contact</TableCell>
                  <TableCell>Builder</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Status</TableCell>
                  {canManageBuilderContacts && (
                    <TableCell align="right" width={72}>Actions</TableCell>
                  )}
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
                        {buildersById.get(contact.builderId)?.name ?? 'Unknown builder'}
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
                    <TableCell>
                      <Chip
                        label={contact.isActive ? 'Active' : 'Inactive'}
                        size="small"
                        color={contact.isActive ? 'success' : 'default'}
                        variant={contact.isActive ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    {canManageBuilderContacts && (
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          aria-label={`Actions for ${contact.name}`}
                          onClick={(event) => handleMenuOpen(event, contact)}
                        >
                          <MoreHorizRoundedIcon />
                        </IconButton>
                      </TableCell>
                    )}
                  </TableRow>
                ))}

                {visibleContacts.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={canManageBuilderContacts ? 6 : 5}
                      sx={{ py: 8, textAlign: 'center' }}
                    >
                      <SearchRoundedIcon color="action" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography fontWeight={600}>
                        {loading ? 'Loading contacts...' : 'No contacts found'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {loading
                          ? 'Loading Builder Contacts from Supabase.'
                          : 'Try changing your search, builder, type or status filter.'}
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

      {canManageBuilderContacts && (
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
            disabled={!selectedContact?.isActive}
            sx={{ color: 'error.main' }}
          >
            <BlockRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
            Deactivate
          </MenuItem>
        </Menu>
      )}

      {dialogState && (
        <ContactDialog
          key={dialogState.contact?.id ?? 'new'}
          contact={dialogState.contact}
          contacts={contacts}
          builders={dialogBuilders}
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
        <DialogTitle>Deactivate contact?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deactivateTarget
              ? `${deactivateTarget.name} will remain in the ${buildersById.get(deactivateTarget.builderId)?.name ?? 'builder'} contact history, but will no longer be available for new assignments.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            color="inherit"
            disabled={submitting}
            onClick={() => setDeactivateTarget(null)}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={submitting}
            onClick={handleDeactivate}
            disableElevation
          >
            {submitting ? 'Deactivating...' : 'Deactivate contact'}
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
