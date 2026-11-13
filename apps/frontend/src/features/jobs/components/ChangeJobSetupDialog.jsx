import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { listBuilderSetupVersions } from '../../builder-draw-schedules/services/builderBillingSetupsRepository.js'
import { describeSetupHeadline, diffSetups } from '../../builder-draw-schedules/utils/setupSummary.js'
import { changeJobSetup, previewJobSetupChange } from '../services/jobSetupRepository.js'

function versionLabel(setup, currentId) {
  const tags = [
    setup.id === currentId ? 'this Job uses it' : null,
    setup.status === 'ACTIVE' ? "Builder's current setup" : null,
  ].filter(Boolean)
  return `Version ${setup.versionNumber}${tags.length > 0 ? ` · ${tags.join(' · ')}` : ''}`
}

function Comparison({ diff, fromVersion, toVersion }) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? diff.rows : diff.rows.filter(({ changed }) => changed)

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1.5, py: 1, alignItems: 'center', bgcolor: 'action.hover' }}
      >
        <Typography fontWeight={800} sx={{ flex: 1 }}>
          {diff.changedCount === 0
            ? 'Nothing differs between the two versions'
            : `${diff.changedCount} ${diff.changedCount === 1 ? 'difference' : 'differences'}`}
        </Typography>
        <Button size="small" color="inherit" onClick={() => setShowAll((current) => !current)} sx={{ textTransform: 'none' }}>
          {showAll ? 'Show only differences' : 'Show everything'}
        </Button>
      </Stack>

      <Box
        sx={{
          // Only where the columns sit side by side.
          display: { xs: 'none', sm: 'grid' },
          gridTemplateColumns: '150px minmax(0, 1fr) minmax(0, 1fr)',
          columnGap: 1.5,
          px: 1.5,
          py: 0.75,
          borderBottom: 1,
          borderColor: 'divider',
        }}
        aria-hidden="true"
      >
        <span />
        <Typography variant="caption" color="text.secondary" fontWeight={700}>
          Now · Version {fromVersion}
        </Typography>
        <Typography variant="caption" color="text.secondary" fontWeight={700}>
          After · Version {toVersion}
        </Typography>
      </Box>

      {rows.map((row) => (
        <Box
          key={`${row.group}-${row.label}`}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '150px minmax(0, 1fr) minmax(0, 1fr)' },
            columnGap: 1.5,
            rowGap: 0.25,
            px: 1.5,
            py: 0.9,
            borderTop: 1,
            borderColor: 'divider',
            borderLeft: 4,
            borderLeftColor: row.changed ? 'warning.main' : 'transparent',
          }}
        >
          <Typography variant="body2" color="text.secondary">{row.label}</Typography>
          <Typography
            variant="body2"
            color={row.changed ? 'text.secondary' : 'text.primary'}
            sx={{ overflowWrap: 'anywhere', textDecoration: row.changed ? 'line-through' : 'none' }}
          >
            {row.from}
          </Typography>
          <Typography
            variant="body2"
            fontWeight={row.changed ? 800 : 400}
            sx={{ overflowWrap: 'anywhere' }}
          >
            {row.to}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Moves a Job to another version of its Builder's billing setup. It lists the Builder's versions,
 * checks with the database what would stop the change (a Package that is not voided, Utility rows
 * that do not match) and what to look at (Draws, Hardware prices), and shows the two versions
 * side by side. Nothing changes until "Use this version".
 */
export default function ChangeJobSetupDialog({ job, currentSetup, onClose, onChanged }) {
  const [versions, setVersions] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [preview, setPreview] = useState({ key: null, result: null, error: '' })
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const currentId = currentSetup.id

  useEffect(() => {
    let ignore = false
    listBuilderSetupVersions(job.builderId)
      .then((list) => {
        if (ignore) return
        setVersions(list)
        // Starts on the Builder's current setup when it is not the one the Job has.
        const suggested = list.find((setup) => setup.status === 'ACTIVE' && setup.id !== currentId)
          ?? list.find((setup) => setup.id !== currentId)
        setSelectedId(suggested ? String(suggested.id) : '')
      })
      .catch((error) => {
        if (!ignore) setLoadError(error.message)
      })
    return () => {
      ignore = true
    }
  }, [job.builderId, currentId])

  const selected = useMemo(
    () => versions?.find((setup) => String(setup.id) === selectedId) ?? null,
    [versions, selectedId],
  )

  useEffect(() => {
    if (!selected) return undefined
    let ignore = false
    previewJobSetupChange(job.id, selected.id)
      .then((result) => {
        if (!ignore) setPreview({ key: selected.id, result, error: '' })
      })
      .catch((error) => {
        if (!ignore) setPreview({ key: selected.id, result: null, error: error.message })
      })
    return () => {
      ignore = true
    }
  }, [job.id, selected])

  const checking = Boolean(selected) && preview.key !== selected.id
  const result = !checking && selected ? preview.result : null
  const diff = selected ? diffSetups(currentSetup, selected) : null
  const canConfirm = Boolean(result?.allowed) && !submitting

  const handleConfirm = async () => {
    setSubmitting(true)
    setSubmitError('')
    try {
      await changeJobSetup({ jobId: job.id, versionId: selected.id, reason })
      onChanged(`Job ${job.code} now bills with version ${selected.versionNumber}.`)
    } catch (error) {
      setSubmitError(error.message)
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="change-job-setup-title"
    >
      <DialogTitle id="change-job-setup-title" sx={{ pb: 1 }}>
        <Typography variant="h6" component="span" fontWeight={750} sx={{ display: 'block' }}>
          Change the billing setup of Job {job.code}
        </Typography>
        <Typography variant="body2" color="text.secondary" component="span" sx={{ display: 'block' }}>
          The Job keeps its Plans, Options and prices. Only what it bills with changes, and only while
          it has no Package.
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          {loadError && <Alert severity="error">{loadError}</Alert>}
          {!versions && !loadError && (
            <Box sx={{ py: 5, display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box>
          )}

          {versions && !selected && (
            <Alert severity="info">
              This Builder has no other version of its setup. To use different numbers, edit the Builder&apos;s
              setup in Builder Setups first: that creates a new version.
            </Alert>
          )}

          {versions && versions.length > 0 && (
            <TextField
              select
              size="small"
              label="Use this version"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              disabled={submitting}
              helperText={selected ? describeSetupHeadline(selected) : undefined}
            >
              {versions.map((setup) => (
                <MenuItem key={setup.id} value={String(setup.id)} disabled={setup.id === currentId}>
                  {versionLabel(setup, currentId)}
                </MenuItem>
              ))}
            </TextField>
          )}

          {checking && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">Checking the Job…</Typography>
            </Stack>
          )}
          {preview.error && selected && !checking && <Alert severity="error">{preview.error}</Alert>}

          {result?.blockers.length > 0 && (
            <Alert severity="error">
              <Typography variant="body2" fontWeight={700}>This version cannot be used yet</Typography>
              {result.blockers.map((blocker) => (
                <Typography key={blocker.code} variant="body2">• {blocker.message}</Typography>
              ))}
            </Alert>
          )}
          {result?.warnings.length > 0 && (
            <Alert severity="warning">
              <Typography variant="body2" fontWeight={700}>Take a look before you confirm</Typography>
              {result.warnings.map((warning) => (
                <Typography key={warning.code} variant="body2">• {warning.message}</Typography>
              ))}
            </Alert>
          )}

          {diff && (
            <Comparison
              diff={diff}
              fromVersion={currentSetup.versionNumber}
              toVersion={selected.versionNumber}
            />
          )}

          {selected && (
            <TextField
              size="small"
              label="Reason (optional)"
              placeholder="For example: the wrap was 2%, not 1%"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={submitting}
              slotProps={{ htmlInput: { maxLength: 500 } }}
              helperText="Saved with the change, so anyone can see why it was made."
            />
          )}

          {submitError && <Alert severity="error">{submitError}</Alert>}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Chip
          size="small"
          variant="outlined"
          label={selected ? `Version ${currentSetup.versionNumber} → ${selected.versionNumber}` : 'Choose a version'}
          sx={{ mr: 'auto', ml: 1 }}
        />
        <Button variant="contained" disableElevation disabled={!canConfirm} onClick={handleConfirm}>
          {submitting ? 'Changing…' : 'Use this version'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
