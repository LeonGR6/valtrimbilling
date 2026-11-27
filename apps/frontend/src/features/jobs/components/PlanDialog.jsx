import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { emptyJobPlan } from '../data/jobs.js'
import { createJobPlanSchema } from '../schemas/jobSequenceSheetSchema.js'
import { CopyOptionsPicker } from './CopyPlanOptions.jsx'
import { emptyCopySelection, plansToCopyFrom, selectedCopyOptions } from '../services/planOptionCopy.js'

export default function PlanDialog({ plans, plan, onClose, onSave, submitting }) {
  // A new Plan can start with Options copied from another Plan of the Job.
  const copySources = useMemo(() => (plan ? [] : plansToCopyFrom(plans)), [plan, plans])
  const [copyValue, setCopyValue] = useState(emptyCopySelection)
  const schema = useMemo(
    () => createJobPlanSchema(plans, plan?.id),
    [plan?.id, plans],
  )
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: plan
      ? { code: plan.code, name: plan.name ?? '' }
      : { ...emptyJobPlan },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

  

  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit((form) => onSave(form, selectedCopyOptions(copySources, copyValue)))}
      noValidate
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h6" component="div" fontWeight={750}>
              {plan ? 'Edit plan' : 'Add plan'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Enter the Plan exactly as it should appear in the Job worksheet.
            </Typography>
          </Box>
          <Chip size="small" variant="outlined" color="primary" label="Plan worksheet" />
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small" sx={{ minWidth: 560 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ width: 190, fontWeight: 750, color: 'text.secondary' }}>
                  Plan code <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </TableCell>
                <TableCell sx={{ fontWeight: 750, color: 'text.secondary' }}>
                  Plan name
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow sx={{ verticalAlign: 'top' }}>
                <TableCell>
                  <TextField
                    placeholder="Example: 2-ADA"
                    {...register('code')}
                    error={Boolean(errors.code)}
                    helperText={errors.code?.message ?? 'Required'}
                    fullWidth
                    size="small"
                    sx={{ '& .MuiInputBase-input': { fontWeight: 800 } }}
                    slotProps={{ htmlInput: { maxLength: 40, 'aria-label': 'Plan code' } }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    placeholder="Optional descriptive name"
                    {...register('name')}
                    error={Boolean(errors.name)}
                    helperText={errors.name?.message ?? 'Optional'}
                    fullWidth
                    size="small"
                    slotProps={{ htmlInput: { maxLength: 100, 'aria-label': 'Plan name' } }}
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        {copySources.length > 0 && (
          <Box sx={{ mt: 2.5 }}>
            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.25 }}>
              Options
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
              If this plan has the same options as another one, copy them instead of
              typing them again. You can choose which ones.
            </Typography>
            <CopyOptionsPicker
              sources={copySources}
              value={copyValue}
              onChange={setCopyValue}
              disabled={submitting}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation disabled={submitting}>
          {submitting ? 'Saving...' : plan ? 'Save changes' : 'Add plan'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
