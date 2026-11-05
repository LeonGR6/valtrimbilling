import { useMemo, useRef } from 'react'
import { Box, Button, Chip, MenuItem, Paper, Stack, TextField, Tooltip } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'

import DateField from '../../../components/common/DateField.jsx'
import { useBuilders } from '../../builders/context/useBuilders.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import { changeOrderStatuses } from '../data/changeOrders.js'
import Field from './ChangeOrderField.jsx'

// Columns of the card on a wide card; every field says how many it spans.
const WIDE = '@container (min-width: 640px)'
const span = (columns) => ({ [WIDE]: { gridColumn: `span ${columns}` } })

/**
 * Who the Extra / CO is for, why it is asked and when. `errors` has the message of each field that
 * must be fixed ({ title: '...' }); only Admin can save it already approved (`canApprove`). The
 * Internal # box says `numberPlaceholder` (the number the Extra / CO will get) when it is emptied.
 * With `statusLocked` the status is only shown: an existing one is moved from its own page.
 */
export default function ChangeOrderBasicsCard({
  values,
  onChange,
  errors = {},
  canApprove = true,
  numberPlaceholder = '',
  statusLocked = false,
}) {
  const { builders } = useBuilders()
  const { jobs } = useJobs()
  const fileInput = useRef(null)

  // The Communities are the ones the selected Builder has Jobs in.
  const communities = useMemo(() => {
    if (!values.builderId) return []
    const names = jobs
      .filter((job) => String(job.builderId) === String(values.builderId))
      .map((job) => job.community)
    return [...new Set(names)].sort((left, right) => left.localeCompare(right))
  }, [jobs, values.builderId])

  const handleBuilderChange = (event) => {
    // A different Builder makes the previous Community and Job meaningless.
    onChange({ builderId: event.target.value, community: '', jobId: '' })
  }

  // The Add button is disabled until attachments can be stored: nothing picked would be saved.
  const handleFilesPicked = (event) => {
    const picked = [...event.target.files].map((file) => file.name)
    onChange({ attachments: [...values.attachments, ...picked] })
    event.target.value = ''
  }

  const removeAttachment = (index) => onChange({
    attachments: values.attachments.filter((_, position) => position !== index),
  })

  // A new Extra / CO is saved as Draft or Pending; Approved is for Admin.
  const statuses = changeOrderStatuses.filter((status) => canApprove || status.value !== 'APPROVED')

  return (
    <Paper
      variant="outlined"
      sx={{ p: { xs: 2, md: 3 }, borderRadius: 2, containerType: 'inline-size' }}
    >
      {/* Columns follow the width of the card, which shrinks when the summary is beside it. */}
      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: '1fr',
          [WIDE]: { gridTemplateColumns: 'repeat(4, 1fr)' },
        }}
      >
        <Field label="Internal CO / Extra #">
          <TextField
            fullWidth
            size="small"
            placeholder={numberPlaceholder || 'E-2026-0047'}
            value={values.internalNumber}
            onChange={(event) => onChange({ internalNumber: event.target.value })}
            error={Boolean(errors.internalNumber)}
            helperText={errors.internalNumber}
          />
        </Field>

        <Field label="Title" required sx={span(2)}>
          <TextField
            fullWidth
            size="small"
            placeholder="Upgrade passage locks to electronic locks"
            value={values.title}
            onChange={(event) => onChange({ title: event.target.value })}
            error={Boolean(errors.title)}
            helperText={errors.title}
          />
        </Field>

        <Field label="Status">
          <TextField
            select
            fullWidth
            size="small"
            value={values.status}
            onChange={(event) => onChange({ status: event.target.value })}
            disabled={statusLocked}
            helperText={statusLocked ? 'Changed from its page' : undefined}
          >
            {(statusLocked ? changeOrderStatuses : statuses).map((status) => (
              <MenuItem key={status.value} value={status.value}>{status.label}</MenuItem>
            ))}
          </TextField>
        </Field>

        <Field label="Builder" required>
          <TextField
            select
            fullWidth
            size="small"
            value={values.builderId}
            onChange={handleBuilderChange}
            error={Boolean(errors.builderId)}
            helperText={errors.builderId}
          >
            {builders.map((builder) => (
              <MenuItem key={builder.id} value={builder.id}>{builder.name}</MenuItem>
            ))}
          </TextField>
        </Field>

        <Field label="Community" required sx={span(3)}>
          <TextField
            select
            fullWidth
            size="small"
            disabled={!values.builderId}
            value={values.community}
            onChange={(event) => onChange({ community: event.target.value, jobId: '' })}
            error={Boolean(errors.community)}
            helperText={errors.community}
          >
            {communities.map((community) => (
              <MenuItem key={community} value={community}>{community}</MenuItem>
            ))}
          </TextField>
        </Field>

        <Field label="Requested By" required sx={span(2)}>
          <TextField
            fullWidth
            size="small"
            placeholder="Carlos Ramirez"
            value={values.requestedBy}
            onChange={(event) => onChange({ requestedBy: event.target.value })}
            error={Boolean(errors.requestedBy)}
            helperText={errors.requestedBy}
          />
        </Field>

        <Field label="Request Date">
          <DateField
            size="small"
            value={values.requestDate}
            onChange={(requestDate) => onChange({ requestDate })}
          />
        </Field>

        <Field label="Needed By Date">
          <DateField
            size="small"
            value={values.neededByDate}
            onChange={(neededByDate) => onChange({ neededByDate })}
            error={Boolean(errors.neededByDate)}
            helperText={errors.neededByDate}
          />
        </Field>

        <Field label="Attachments" sx={span(4)}>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
            {values.attachments.map((name, index) => (
              <Chip
                key={`${name}-${index}`}
                icon={<InsertDriveFileOutlinedIcon />}
                label={name}
                onDelete={() => removeAttachment(index)}
              />
            ))}
            <Tooltip title="Attachments cannot be saved yet">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddRoundedIcon />}
                  disabled
                  onClick={() => fileInput.current?.click()}
                  sx={{ borderStyle: 'dashed', borderRadius: 4 }}
                >
                  Add
                </Button>
              </span>
            </Tooltip>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={handleFilesPicked}
            />
          </Stack>
        </Field>
      </Box>
    </Paper>
  )
}
