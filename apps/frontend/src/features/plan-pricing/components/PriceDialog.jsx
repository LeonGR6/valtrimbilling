import { useMemo } from 'react'
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
  InputAdornment,
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
import { createHardwarePriceSchema, optionPriceSchema, priceSchema } from '../schemas/priceSchema.js'
import { hasPrice } from '../utils/planPriceFormat.js'

export default function PriceDialog({ target, onClose, onSave, submitting }) {
  const isPlan = target.type === 'plan'
  const isHardware = target.type === 'hardware'
  const currentPrice = isPlan
    ? target.plan.price
    : isHardware
      ? target.plan.hardwarePrice
      : target.option.price
  const schema = useMemo(
    () => isHardware
      ? createHardwarePriceSchema(target.plan.price)
      : isPlan ? priceSchema : optionPriceSchema,
    [isHardware, isPlan, target.plan.price],
  )
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: !isPlan && !isHardware && target.option.priceNotApplicable
        ? 'NA'
        : hasPrice(currentPrice) ? String(currentPrice) : '',
    },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const itemLabel = isPlan ? 'Plan' : isHardware ? 'Hardware' : 'Option'
  const itemCode = isPlan || isHardware ? target.plan.code : target.option.code
  const priceLabel = isPlan
    ? 'Plan price'
    : isHardware
      ? 'Hardware price'
      : 'Option price'

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
              Edit {priceLabel.toLowerCase()}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {isPlan || isHardware
                ? target.plan.name || `Plan ${target.plan.code}`
                : target.option.description}
            </Typography>
          </Box>
          <Chip size="small" variant="outlined" color="primary" label="Pricing worksheet" />
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small" sx={{ minWidth: 650 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ width: 135, fontWeight: 750, color: 'text.secondary' }}>
                  Item
                </TableCell>
                <TableCell sx={{ width: 190, fontWeight: 750, color: 'text.secondary' }}>
                  Code
                </TableCell>
                <TableCell sx={{ fontWeight: 750, color: 'text.secondary' }}>
                  {priceLabel} <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow sx={{ verticalAlign: 'top' }}>
                <TableCell sx={{ pt: 2.25 }}>
                  <Typography variant="body2" fontWeight={750}>{itemLabel}</Typography>
                </TableCell>
                <TableCell sx={{ pt: 2.25 }}>
                  <Typography
                    component={isPlan || isHardware ? 'strong' : 'span'}
                    variant="body1"
                    sx={{
                      fontWeight: isPlan || isHardware ? '900 !important' : 700,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {itemCode}
                  </Typography>
                </TableCell>
                <TableCell>
                  <TextField
                    autoFocus
                    placeholder={isPlan || isHardware ? '0.00' : '0.00 or NA'}
                    type={isPlan || isHardware ? 'number' : 'text'}
                    {...register('amount')}
                    error={Boolean(errors.amount)}
                    helperText={
                      errors.amount?.message
                      ?? (isPlan || isHardware
                        ? 'USD · Up to 2 decimal places.'
                        : 'USD · Up to 2 decimal places. A negative price is a credit and is subtracted when the option is billed. Type NA if no price applies: it adds and subtracts nothing.')
                    }
                    fullWidth
                    size="small"
                    slotProps={{
                      input: {
                        startAdornment: isPlan || isHardware
                          ? <InputAdornment position="start">$</InputAdornment>
                          : undefined,
                      },
                      htmlInput: {
                        ...(isPlan || isHardware ? { min: 0 } : {}),
                        step: 0.01,
                        // An Option price can be negative or "NA", which a numeric
                        // keypad cannot type.
                        inputMode: isPlan || isHardware ? 'decimal' : 'text',
                        'aria-label': priceLabel,
                      },
                    }}
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
          {submitting ? 'Saving...' : 'Save price'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
