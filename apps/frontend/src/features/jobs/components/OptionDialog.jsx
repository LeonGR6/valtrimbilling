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
import { emptyPlanOption } from '../data/jobs.js'
import { planOptionSchema } from '../schemas/jobSequenceSheetSchema.js'

export default function OptionDialog({ plan, option, onClose, onSave, submitting }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(planOptionSchema),
    defaultValues: option
      ? { code: option.code, description: option.description }
      : { ...emptyPlanOption },
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
      onSubmit={handleSubmit(onSave)}
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
              {option ? 'Edit option' : 'Add option'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              This Option will be grouped under Plan{' '}
              <Box component="span" sx={{ fontWeight: 800, color: 'text.primary' }}>
                {plan.code}
              </Box>
              .
            </Typography>
          </Box>
          <Chip
            size="small"
            variant="outlined"
            color="primary"
            label={`Plan ${plan.code}`}
          />
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small" sx={{ minWidth: 650 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ width: 130, fontWeight: 750, color: 'text.secondary' }}>
                  Parent plan
                </TableCell>
                <TableCell sx={{ width: 190, fontWeight: 750, color: 'text.secondary' }}>
                  OPT # <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </TableCell>
                <TableCell sx={{ fontWeight: 750, color: 'text.secondary' }}>
                  Option description <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow sx={{ verticalAlign: 'top' }}>
                <TableCell sx={{ pt: 2.25 }}>
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={plan.code}
                    sx={{ fontWeight: 750 }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    placeholder={`Example: OPT 1`}
                    {...register('code')}
                    error={Boolean(errors.code)}
                    helperText={errors.code?.message ?? 'Required'}
                    fullWidth
                    size="small"
                    slotProps={{ htmlInput: { maxLength: 40, 'aria-label': 'Option code' } }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    placeholder="Enter the option description, if doesn't exist, put the same as the OPT #."
                    {...register('description')}
                    error={Boolean(errors.description)}
                    helperText={errors.description?.message ?? 'Required'}
                    multiline
                    minRows={2}
                    fullWidth
                    size="small"
                    slotProps={{ htmlInput: { maxLength: 240, 'aria-label': 'Option description' } }}
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation disabled={submitting}>
          {submitting ? 'Saving...' : option ? 'Save changes' : 'Add option'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
