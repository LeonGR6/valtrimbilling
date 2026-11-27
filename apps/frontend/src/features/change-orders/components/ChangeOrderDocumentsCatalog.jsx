import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  List,
  ListItemButton,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'

import { isStoredString, usePersistentState } from '../../../hooks/usePersistentState.js'
import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import { useChangeOrderPoFiles } from '../hooks/useChangeOrderPoFiles.js'
import {
  documentJobBuilderOptions,
  filterDocumentJobs,
  groupChangeOrdersByJob,
} from '../utils/documentJobs.js'
import ChangeOrderStatusChip from './ChangeOrderStatusChip.jsx'
import PoFileItem from './PoFileItem.jsx'
import PoUploadDialog from './PoUploadDialog.jsx'

const count = (value, one, many) => `${value} ${value === 1 ? one : many}`

const sectionTitleSx = {
  px: { xs: 2, sm: 2.5 },
  pt: 1.75,
  pb: 0.75,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
}

const iconTileSx = {
  width: 44,
  height: 44,
  flexShrink: 0,
  borderRadius: 1.5,
  display: 'grid',
  placeItems: 'center',
  bgcolor: 'primary.light',
  color: 'primary.main',
}

/**
 * Documents of the Extras / Change Orders, one folder per Job that has Extras / COs or Purchase Order
 * PDFs. A Job opens to its builder Purchase Orders (upload, open, delete) and its Extras / COs.
 */
export default function ChangeOrderDocumentsCatalog({ orders, loading: ordersLoading }) {
  const navigate = useNavigate()
  const { jobs: catalog } = useJobs()
  const poFiles = useChangeOrderPoFiles()
  const [search, setSearch] = usePersistentState('change-orders:documents:search', '', isStoredString)
  const [storedBuilder, setBuilder] = usePersistentState('change-orders:documents:builder', 'ALL', isStoredString)
  // Every Job starts collapsed: opening one is the user's choice.
  const [expandedJobId, setExpandedJobId] = useState(null)
  // The Job PDFs go to (null: chosen in the dialog), while the dialog is open.
  const [uploadTarget, setUploadTarget] = useState(undefined)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [notice, setNotice] = useState('')

  const loading = ordersLoading || poFiles.loading
  const jobs = useMemo(
    () => groupChangeOrdersByJob(orders, { poFilesByJob: poFiles.filesByJob, jobs: catalog }),
    [orders, poFiles.filesByJob, catalog],
  )
  const builderOptions = useMemo(() => documentJobBuilderOptions(jobs), [jobs])
  // A remembered Builder that no longer has a folder falls back to "All".
  const builderId = storedBuilder === 'ALL' || builderOptions.some(({ id }) => id === storedBuilder)
    ? storedBuilder
    : 'ALL'
  const visibleJobs = useMemo(
    () => filterDocumentJobs(jobs, { search, builderId }),
    [jobs, search, builderId],
  )
  const hasFilters = Boolean(search.trim()) || builderId !== 'ALL'
  const clearFilters = () => {
    setSearch('')
    setBuilder('ALL')
  }

  // With `readAfter`, the PDFs that went in are read right away, one after the other, while the person
  // keeps working: each one shows "Reading…" until its orders appear.
  const upload = async (job, files, readAfter) => {
    const jobId = job.jobId ?? job.id
    const result = await poFiles.upload(jobId, files)
    if (result.uploaded.length > 0) {
      setExpandedJobId(jobId)
      setNotice(`${count(result.uploaded.length, 'PDF', 'PDFs')} uploaded${readAfter ? '; reading the orders in them…' : '.'}`)
      if (readAfter) poFiles.read(result.uploadedIds)
    }
    return result
  }

  const confirmDelete = async () => {
    setDeleting(true)
    setDeleteError('')
    try {
      await poFiles.remove(deleteTarget)
      setNotice(`${deleteTarget.name} deleted.`)
      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(error.message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Box sx={{ p: { xs: 2.5, md: 4 } }}>
      <Card variant="outlined" sx={{ mb: 2.5, p: { xs: 2, sm: 2.5 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Box sx={iconTileSx}><FolderOpenRoundedIcon /></Box>
            <Box>
              <Typography variant="h6" fontWeight={850}>Extra / CO document center</Typography>
              <Typography variant="body2" color="text.secondary">
                One folder per Job, with the builder Purchase Orders and its Extras / Change Orders.
              </Typography>
            </Box>
          </Stack>
          {poFiles.canManage && (
            <Button
              variant="contained"
              disableElevation
              startIcon={<CloudUploadRoundedIcon />}
              onClick={() => setUploadTarget(null)}
              sx={{ flexShrink: 0 }}
            >
              Upload POs
            </Button>
          )}
        </Stack>

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          sx={{ mt: 2.25, alignItems: { md: 'center' } }}
        >
          <TextField
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Job, builder, community, Extra / CO, PO / CO # or PDF name"
            size="small"
            sx={{ flex: 2, minWidth: { md: 260 } }}
            slotProps={{
              htmlInput: { 'aria-label': 'Search Extra / CO document Jobs' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon color="action" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            select
            size="small"
            label="Builder"
            value={builderId}
            onChange={(event) => setBuilder(event.target.value)}
            sx={{ flex: 1, minWidth: { md: 200 } }}
          >
            <MenuItem value="ALL">All builders</MenuItem>
            {builderOptions.map(({ id, name }) => (
              <MenuItem key={id} value={id}>{name}</MenuItem>
            ))}
          </TextField>
          <Button color="inherit" onClick={clearFilters} disabled={!hasFilters} sx={{ flexShrink: 0 }}>
            Clear filters
          </Button>
        </Stack>
        {!loading && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }}>
            Showing {visibleJobs.length} of {count(jobs.length, 'Job', 'Jobs')}.
          </Typography>
        )}
      </Card>

      {poFiles.error && (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={poFiles.reload}>Retry</Button>}
          sx={{ mb: 2.5 }}
        >
          {poFiles.error}
        </Alert>
      )}

      {loading && (
        <Box sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
          <Stack spacing={1.25} sx={{ alignItems: 'center' }}>
            <CircularProgress size={30} />
            <Typography variant="body2" color="text.secondary">Loading Jobs and Purchase Orders…</Typography>
          </Stack>
        </Box>
      )}

      {!loading && (
        <Stack spacing={2}>
          {visibleJobs.map((job) => {
            const isExpanded = String(expandedJobId) === String(job.jobId)
            return (
              <Accordion
                key={job.jobId}
                expanded={isExpanded}
                onChange={(_, expanded) => setExpandedJobId(expanded ? job.jobId : null)}
                disableGutters
                elevation={0}
                slotProps={{ transition: { unmountOnExit: true } }}
                sx={{
                  border: 1,
                  borderColor: isExpanded ? 'primary.main' : 'divider',
                  borderRadius: '10px !important',
                  overflow: 'hidden',
                  bgcolor: 'background.paper',
                  '&::before': { display: 'none' },
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreRoundedIcon />}
                  aria-controls={`co-job-${job.jobId}-documents`}
                  id={`co-job-${job.jobId}-documents-header`}
                  sx={{ minHeight: 76, '& .MuiAccordionSummary-content': { my: 1.5, minWidth: 0 } }}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    sx={{
                      width: '100%',
                      pr: 1,
                      minWidth: 0,
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      justifyContent: 'space-between',
                    }}
                  >
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                      <Box sx={iconTileSx}><FolderOpenRoundedIcon /></Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight={850}>Job #{job.jobCode}</Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {job.builderName} · {job.community}
                        </Typography>
                      </Box>
                    </Stack>
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        icon={<PictureAsPdfRoundedIcon />}
                        label={count(job.poFiles.length, 'PO PDF', 'PO PDFs')}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={count(job.orders.length, 'Extra / CO', 'Extras / COs')}
                      />
                    </Stack>
                  </Stack>
                </AccordionSummary>

                <Divider />
                <AccordionDetails id={`co-job-${job.jobId}-documents`} sx={{ p: 0, pb: 1 }}>
                  <Box sx={sectionTitleSx}>
                    <Typography variant="subtitle2" fontWeight={800}>Purchase Orders</Typography>
                    {poFiles.canManage && (
                      <Button
                        size="small"
                        startIcon={<CloudUploadRoundedIcon />}
                        onClick={() => setUploadTarget(job)}
                      >
                        Upload POs
                      </Button>
                    )}
                  </Box>
                  {job.poFiles.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ px: { xs: 2, sm: 2.5 }, pb: 1 }}>
                      No Purchase Orders uploaded yet.
                    </Typography>
                  ) : (
                    <Box aria-label={`Purchase Orders of Job #${job.jobCode}`} role="list">
                      {job.poFiles.map((file) => (
                        <PoFileItem
                          key={file.id}
                          file={file}
                          orders={poFiles.ordersByFile[file.id] ?? []}
                          changeOrdersByOrder={poFiles.changeOrdersByOrder}
                          reading={poFiles.readingIds.has(file.id)}
                          readError={poFiles.readErrors[file.id] ?? ''}
                          canManage={poFiles.canManage}
                          opening={poFiles.openingId === file.id}
                          onOpen={() => poFiles.open(file)}
                          onRead={() => poFiles.read([file.id])}
                          onDelete={() => {
                            setDeleteError('')
                            setDeleteTarget(file)
                          }}
                        />
                      ))}
                    </Box>
                  )}

                  <Divider sx={{ mt: 1 }} />
                  <Box sx={sectionTitleSx}>
                    <Typography variant="subtitle2" fontWeight={800}>Extras / Change Orders</Typography>
                  </Box>
                  {job.orders.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ px: { xs: 2, sm: 2.5 }, pb: 1 }}>
                      This Job has no Extra / Change Order yet.
                    </Typography>
                  ) : (
                    <List disablePadding aria-label={`Extras / COs of Job #${job.jobCode}`}>
                      {job.orders.map((order, index) => (
                        <ListItemButton
                          key={order.id}
                          divider={index < job.orders.length - 1}
                          onClick={() => navigate(`/change-orders/${order.id}`)}
                          sx={{ px: { xs: 2, sm: 2.5 }, py: 1.25, gap: 2, flexWrap: 'wrap' }}
                        >
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="body2" fontWeight={700}>
                              {order.number}
                              {order.poCoNumber && (
                                <Typography component="span" variant="body2" color="text.secondary" fontWeight={500}>
                                  {' · '}PO / CO # {order.poCoNumber}
                                </Typography>
                              )}
                            </Typography>
                          </Box>
                          <Typography variant="body2" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
                            {formatCurrency(order.totalAmount)}
                          </Typography>
                          <ChangeOrderStatusChip status={order.status} />
                        </ListItemButton>
                      ))}
                    </List>
                  )}
                </AccordionDetails>
              </Accordion>
            )
          })}

          {visibleJobs.length === 0 && (
            <Card variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
              <FolderOpenRoundedIcon color="disabled" sx={{ fontSize: 42 }} />
              <Typography fontWeight={750} sx={{ mt: 1 }}>
                {jobs.length === 0 ? 'No Jobs with Extras / COs or Purchase Orders yet' : 'No Jobs match these filters'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {jobs.length === 0
                  ? 'A Job gets its folder here once it has an Extra / Change Order or an uploaded Purchase Order.'
                  : 'Clear the search and filters to see every Job.'}
              </Typography>
              {hasFilters && <Button onClick={clearFilters} sx={{ mt: 1.5 }}>Clear filters</Button>}
            </Card>
          )}
        </Stack>
      )}

      {uploadTarget !== undefined && (
        <PoUploadDialog
          job={uploadTarget}
          jobs={catalog}
          onUpload={upload}
          onClose={() => setUploadTarget(undefined)}
        />
      )}

      {deleteTarget && (
        <Dialog open fullWidth maxWidth="xs" onClose={deleting ? undefined : () => setDeleteTarget(null)}>
          <DialogTitle>Delete PDF?</DialogTitle>
          <DialogContent>
            <Typography color="text.secondary">
              <strong>{deleteTarget.name}</strong> will be permanently deleted. This cannot be undone.
            </Typography>
            {deleteError && <Alert severity="error" sx={{ mt: 2 }}>{deleteError}</Alert>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button
              color="error"
              variant="contained"
              disableElevation
              startIcon={<DeleteOutlineRoundedIcon />}
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete PDF'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4000}
        onClose={(_, reason) => reason !== 'clickaway' && setNotice('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setNotice('')} sx={{ width: '100%' }}>{notice}</Alert>
      </Snackbar>
    </Box>
  )
}
