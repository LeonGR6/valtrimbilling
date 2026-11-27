import {
  Alert,
  Box,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'

import { sanitizePriceInput, settlePriceText } from '../utils/pricing.js'

const dollarAdornment = { startAdornment: <InputAdornment position="start">$</InputAdornment> }

const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`

/**
 * The Scope of Work and Amount of each Plan chosen, when the Extra / CO covers Specific Plan Types. The
 * Lots of a Plan follow them (a Lot can still be given its own below), and once the Extra / CO is approved
 * they are also what a Lot of that Plan billed later is charged with.
 * `plans` are the Plans chosen, in the Job's order, each with `lots` (how many it reaches today).
 * `onChange(planId, changes)` changes one Plan; `onAmountSettled(planId, amount)` runs when the person
 * leaves an Amount, with the amount in cents.
 */
export default function ChangeOrderPlanRules({ plans, planRules, onChange, onAmountSettled }) {
  if (plans.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        Choose the Plans above: each one gets its own Scope of Work and Amount here.
      </Typography>
    )
  }

  return (
    <Box sx={{ mb: 2.5 }}>
      <Alert severity="info" sx={{ mb: 1.5 }}>
        Once approved, every Lot of these Plans added to the Job later is charged too, with the Scope and
        Amount of its Plan: the first Package that bills it makes an Extra / CO of its own for it.
      </Alert>
      <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
        <Table size="small" aria-label="Scope and Amount by Plan" sx={{ minWidth: 640 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 200 }}>Plan</TableCell>
              <TableCell sx={{ minWidth: 280 }}>Scope of Work</TableCell>
              <TableCell sx={{ width: 160 }}>Amount per Lot</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plans.map((plan) => {
              const rule = planRules[plan.id] ?? { scope: '', amount: '' }
              const label = `Plan ${plan.code}`

              return (
                <TableRow key={plan.id}>
                  <TableCell sx={{ py: 1, verticalAlign: 'top' }}>
                    <Typography variant="body2" fontWeight={700}>{label}</Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {[plan.name, plan.lots > 0 ? `${plural(plan.lots, 'lot')} today` : 'No lots yet']
                        .filter(Boolean).join(', ')}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    <TextField
                      fullWidth
                      multiline
                      minRows={1}
                      maxRows={4}
                      size="small"
                      placeholder="What is done, and why"
                      value={rule.scope}
                      onChange={(event) => onChange(plan.id, { scope: event.target.value })}
                      slotProps={{ htmlInput: { 'aria-label': `Scope of Work, ${label}` } }}
                    />
                  </TableCell>
                  <TableCell sx={{ py: 1, verticalAlign: 'top' }}>
                    <TextField
                      fullWidth
                      size="small"
                      placeholder="0.00"
                      value={rule.amount}
                      onChange={(event) => onChange(plan.id, { amount: sanitizePriceInput(event.target.value) })}
                      onBlur={() => onAmountSettled(plan.id, settlePriceText(rule.amount))}
                      slotProps={{
                        input: dollarAdornment,
                        htmlInput: { 'aria-label': `Amount per Lot, ${label}` },
                      }}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
    </Box>
  )
}
