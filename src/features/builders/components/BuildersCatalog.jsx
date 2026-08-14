import { useMemo, useState } from 'react'
import {
  Alert,
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
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { emptyBuilder, initialBuilders } from '../data/builders.js'
import { createBuilderSchema } from '../schemas/builderSchema.js'

function OptionalLabel({ children }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Typography variant="subtitle2" fontWeight={700}>
        {children}
      </Typography>
      <Chip
        label="Optional"
        size="small"
        variant="outlined"
        sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
      />
    </Stack>
  )
}

function BuilderDialog({ open, builder, builders, onClose, onSave }) {
  const schema = useMemo(
    () => createBuilderSchema(builders, builder?.id),
    [builder?.id, builders],
  )
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: builder ? { ...builder } : { ...emptyBuilder },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const description = useWatch({ control, name: 'description' })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {builder ? 'Edit builder' : 'New builder'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {builder
            ? 'Update the company and contact information for this builder.'
            : 'Add a new builder to the company catalog.'}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              Builder information
            </Typography>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Builder code"
                  {...register('code')}
                  error={Boolean(errors.code)}
                  helperText={errors.code?.message ?? 'Example: CV'}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 24 } }}
                />
                <TextField
                  label="Builder name"
                  {...register('name')}
                  error={Boolean(errors.name)}
                  helperText={errors.name?.message ?? ' '}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 100 } }}
                />
              </Stack>

              <Box>
                <OptionalLabel>Description</OptionalLabel>
                <TextField
                  aria-label="Description"
                  {...register('description')}
                  multiline
                  minRows={2}
                  placeholder="Add a short description of this builder..."
                  fullWidth
                  sx={{ mt: 1 }}
                  slotProps={{ htmlInput: { maxLength: 240 } }}
                  error={Boolean(errors.description)}
                  helperText={errors.description?.message ?? `${description.length}/240`}
                />
              </Box>

              <Box>
                <OptionalLabel>Address</OptionalLabel>
                <TextField
                  aria-label="Address"
                  {...register('address')}
                  multiline
                  minRows={2}
                  placeholder="Street, city, state and ZIP code"
                  fullWidth
                  sx={{ mt: 1 }}
                  slotProps={{ htmlInput: { maxLength: 240 } }}
                  error={Boolean(errors.address)}
                  helperText={errors.address?.message}
                />
              </Box>
            </Stack>
          </Box>

          <Box>
            <OptionalLabel>Primary contact</OptionalLabel>
            <Stack spacing={2} sx={{ mt: 1.5 }}>
              <TextField
                label="Contact name"
                {...register('contactName')}
                error={Boolean(errors.contactName)}
                helperText={errors.contactName?.message ?? ' '}
                fullWidth
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Email"
                  type="email"
                  {...register('contactEmail')}
                  error={Boolean(errors.contactEmail)}
                  helperText={errors.contactEmail?.message ?? ' '}
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
                  label="Phone"
                  type="tel"
                  {...register('contactPhone')}
                  error={Boolean(errors.contactPhone)}
                  helperText={errors.contactPhone?.message ?? 'Include the area code.'}
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
              </Stack>
            </Stack>
          </Box>

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
              control={
                <Controller
                  name="isActive"
                  control={control}
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onChange={(_, checked) => field.onChange(checked)}
                      inputRef={field.ref}
                    />
                  )}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    Active builder
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Inactive builders remain visible but cannot be selected.
                  </Typography>
                </Box>
              }
            />
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" type="submit" disableElevation>
          {builder ? 'Save changes' : 'Create builder'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function BuildersCatalog() {
  const [builders, setBuilders] = useState(initialBuilders)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedBuilder, setSelectedBuilder] = useState(null)
  const [dialogState, setDialogState] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [notice, setNotice] = useState(null)

  const filteredBuilders = useMemo(() => {
    const query = search.trim().toLowerCase()

    return builders.filter((builder) => {
      const matchesSearch =
        !query ||
        [
          builder.code,
          builder.name,
          builder.description,
          builder.address,
          builder.contactName,
          builder.contactEmail,
          builder.contactPhone,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      const matchesStatus =
        status === 'all' ||
        (status === 'active' ? builder.isActive : !builder.isActive)

      return matchesSearch && matchesStatus
    })
  }, [builders, search, status])

  const visibleBuilders = filteredBuilders.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  const handleMenuOpen = (event, builder) => {
    setMenuAnchor(event.currentTarget)
    setSelectedBuilder(builder)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setSelectedBuilder(null)
  }

  const openEditDialog = () => {
    setDialogState({ mode: 'edit', builder: selectedBuilder })
    handleMenuClose()
  }

  const openDeleteDialog = () => {
    setDeleteTarget(selectedBuilder)
    handleMenuClose()
  }

  const handleSave = (form) => {
    if (dialogState?.mode === 'edit') {
      setBuilders((current) =>
        current.map((item) =>
          item.id === dialogState.builder.id ? { ...item, ...form } : item,
        ),
      )
      setNotice({ severity: 'success', message: 'Builder updated.' })
    } else {
      setBuilders((current) => [{ ...form, id: Date.now() }, ...current])
      setPage(0)
      setNotice({ severity: 'success', message: 'Builder created.' })
    }

    setDialogState(null)
  }

  const handleDelete = () => {
    setBuilders((current) =>
      current.filter((item) => item.id !== deleteTarget.id),
    )
    setDeleteTarget(null)
    setPage(0)
    setNotice({ severity: 'success', message: 'Builder deleted.' })
  }

  const changeSearch = (event) => {
    setSearch(event.target.value)
    setPage(0)
  }

  const changeStatus = (event) => {
    setStatus(event.target.value)
    setPage(0)
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
            Builders
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage builder companies and their primary contact information.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => setDialogState({ mode: 'create' })}
          disableElevation
          sx={{ whiteSpace: 'nowrap' }}
        >
          New builder
        </Button>
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
              onChange={changeSearch}
              size="small"
              placeholder="Search builders or contacts..."
              sx={{ width: { xs: '100%', md: 360 } }}
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
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id="builder-status-filter-label">Status</InputLabel>
              <Select
                labelId="builder-status-filter-label"
                label="Status"
                value={status}
                onChange={changeStatus}
                startAdornment={
                  <InputAdornment position="start">
                    <FilterListRoundedIcon fontSize="small" color="action" />
                  </InputAdornment>
                }
              >
                <MenuItem value="all">All builders</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="inactive">Inactive</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <TableContainer>
            <Table sx={{ minWidth: 1000 }}>
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
                  <TableCell>Builder</TableCell>
                  <TableCell>Primary contact</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Address</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right" width={72}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleBuilders.map((builder) => (
                  <TableRow
                    key={builder.id}
                    hover
                    sx={{ '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <Box
                          sx={{
                            width: 36,
                            height: 36,
                            borderRadius: 1.5,
                            display: 'grid',
                            placeItems: 'center',
                            bgcolor: 'primary.light',
                            color: 'primary.main',
                            flexShrink: 0,
                          }}
                        >
                          <BusinessRoundedIcon fontSize="small" />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {builder.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {builder.code}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 250 }}>
                      <Typography variant="body2" fontWeight={500} noWrap>
                        {builder.contactName || 'No contact'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {builder.contactEmail || 'No email'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {builder.contactPhone || 'No phone'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ whiteSpace: 'pre-line' }}
                      >
                        {builder.address || 'No address'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={builder.isActive ? 'Active' : 'Inactive'}
                        size="small"
                        color={builder.isActive ? 'success' : 'default'}
                        variant={builder.isActive ? 'filled' : 'outlined'}
                        sx={{
                          fontWeight: 600,
                          ...(builder.isActive && {
                            bgcolor: 'success.light',
                            color: 'success.dark',
                          }),
                        }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        aria-label={`Actions for ${builder.name}`}
                        onClick={(event) => handleMenuOpen(event, builder)}
                      >
                        <MoreHorizRoundedIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}

                {visibleBuilders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ py: 8, textAlign: 'center' }}>
                      <Box
                        sx={{
                          width: 48,
                          height: 48,
                          borderRadius: '50%',
                          bgcolor: 'sidebar.bg',
                          color: 'text.secondary',
                          display: 'grid',
                          placeItems: 'center',
                          mx: 'auto',
                          mb: 1.5,
                        }}
                      >
                        <SearchRoundedIcon />
                      </Box>
                      <Typography fontWeight={600}>No builders found</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Try changing your search or status filter.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={filteredBuilders.length}
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
        <BuilderDialog
          key={dialogState.builder?.id ?? 'new'}
          open
          builder={dialogState.builder}
          builders={builders}
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
        <DialogTitle>Delete builder?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deleteTarget
              ? `${deleteTarget.name} (${deleteTarget.code}) will be removed from this catalog.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disableElevation>
            Delete builder
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
