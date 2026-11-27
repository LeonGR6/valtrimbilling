import { Box, ButtonBase, Chip, Paper, Typography } from '@mui/material'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'

import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { COVERAGE_LABELS } from '../utils/changeOrderSummary.js'

const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`
const figures = { fontVariantNumeric: 'tabular-nums' }
const MAX_PLAN_CHIPS = 6

// What the colors of the Calendar split stand for; the legend always says it in words too.
const EVENT_COLORS = { EXT: 'primary.main', DM: 'info.main', HW: 'warning.main', NONE: 'grey.500' }

const goToStep = (id) => {
  const target = document.getElementById(id)
  if (!target) return
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
}

function Block({ label, children }) {
  return (
    <Box sx={{ py: 1.75, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      {children}
    </Box>
  )
}

function Empty({ children }) {
  return <Typography variant="body2" color="text.disabled">{children}</Typography>
}

/**
 * The Extra / CO as it adds up, always in view beside the form: who it is for, how many Lots it reaches, how
 * they are charged on the Calendar, the total, and the four steps with a way to jump to each.
 * `builderName`, `job` (`{ code, community }`), `coverageMode`, `coverage` (`{ lots, phases, buildings }`),
 * `plans` (`[{ id, code }]` for Specific plan types), `breakdown` (`eventBreakdown`), `amounts`
 * (`summarizeChangeOrderLines`) and `steps` (`formSteps`) come from the form.
 */
export default function ChangeOrderSummaryCard({
  builderName,
  job,
  coverageMode,
  coverage,
  plans,
  breakdown,
  amounts,
  steps,
}) {
  const withoutAmount = amounts.unpriced + amounts.places.unpriced
  const otherLines = amounts.places.count
  const placeOnly = coverage.lots === 0 && otherLines > 0

  return (
    <Paper variant="outlined" component="section" aria-label="Summary of this Extra / CO" sx={{ p: 2.5, borderRadius: 2 }}>
      <Typography variant="subtitle1" component="h2" fontWeight={700} sx={{ mb: 1.5 }}>
        Summary
      </Typography>

      <Box sx={{ pb: 1.75 }}>
        <Typography variant="caption" color="text.secondary" component="div">Builder</Typography>
        {builderName ? (
          <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{builderName}</Typography>
        ) : (
          <Empty>Not chosen yet</Empty>
        )}
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>Job</Typography>
        {job ? (
          <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
            #{job.code}
            {job.community && (
              <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}> · {job.community}</Box>
            )}
          </Typography>
        ) : (
          <Empty>{builderName ? 'Choose the Job' : 'Choose a Builder first'}</Empty>
        )}
      </Box>

      <Block label="Where the work is">
        {coverage.lots > 0 ? (
          <>
            <Typography component="p" sx={{ m: 0, ...figures, lineHeight: 1.1 }}>
              <Box component="span" sx={{ fontSize: 30, fontWeight: 800 }}>{coverage.lots}</Box>{' '}
              <Box component="span" sx={{ fontSize: 15, color: 'text.secondary' }}>
                {coverage.lots === 1 ? 'lot affected' : 'lots affected'}
              </Box>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {COVERAGE_LABELS[coverageMode]} · {plural(coverage.phases, 'phase')}
              {coverage.buildings > 0 && ` · ${plural(coverage.buildings, 'building')}`}
            </Typography>
            {coverageMode === 'plans' && plans.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                {plans.slice(0, MAX_PLAN_CHIPS).map((plan) => (
                  <Chip key={plan.id} size="small" variant="outlined" label={`Plan ${plan.code}`} />
                ))}
                {plans.length > MAX_PLAN_CHIPS && (
                  <Chip size="small" variant="outlined" label={`+${plans.length - MAX_PLAN_CHIPS}`} />
                )}
              </Box>
            )}
          </>
        ) : (
          <Empty>{placeOnly ? 'No lots, only other lines' : 'No lots picked yet'}</Empty>
        )}
      </Block>

      {breakdown.total > 0 && (
        <Block label="Calendar event">
          <Box
            role="img"
            aria-label={breakdown.parts.map((part) => `${part.label} ${part.count}`).join(', ')}
            sx={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: '2px' }}
          >
            {breakdown.parts.map((part) => (
              <Box key={part.key} sx={{ flex: part.count, bgcolor: EVENT_COLORS[part.key], minWidth: 6 }} />
            ))}
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.75, rowGap: 0.25, mt: 0.75 }}>
            {breakdown.parts.map((part) => (
              <Typography key={part.key} variant="body2" sx={{ ...figures, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: EVENT_COLORS[part.key] }} />
                {part.label} <strong>{part.count}</strong>
              </Typography>
            ))}
          </Box>
          {breakdown.needOwn > 0 && (
            <Typography variant="caption" color="warning.main" component="div" sx={{ mt: 0.5, fontWeight: 600 }}>
              {plural(breakdown.needOwn, 'lot')} will need an event of {breakdown.needOwn === 1 ? 'its' : 'their'} own.
            </Typography>
          )}
        </Block>
      )}

      <Block label="Total">
        <Typography
          component="p"
          aria-live="polite"
          sx={{ m: 0, fontSize: 30, fontWeight: 800, lineHeight: 1.1, ...figures }}
        >
          {amounts.total === null ? '—' : formatCurrency(amounts.total)}
        </Typography>
        {(amounts.lots > 0 || otherLines > 0) && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {[
              amounts.lots > 0 && plural(amounts.lots, 'lot line'),
              otherLines > 0 && plural(otherLines, 'other line'),
            ].filter(Boolean).join(' + ')}
          </Typography>
        )}
        {withoutAmount > 0 && (
          <Typography variant="caption" color="warning.main" component="div" sx={{ mt: 0.25, fontWeight: 600 }}>
            {plural(withoutAmount, 'line')} still without an amount.
          </Typography>
        )}
      </Block>

      <Block label="Steps">
        <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.25 }}>
          {steps.map((step) => (
            <li key={step.id}>
              <ButtonBase
                onClick={() => goToStep(step.id)}
                aria-label={`${step.label}: ${step.done ? 'complete' : 'not complete yet'}. Go to this step`}
                sx={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  gap: 1,
                  py: 0.5,
                  px: 0.5,
                  borderRadius: 1,
                  textAlign: 'left',
                  '&:hover': { bgcolor: 'action.hover' },
                  '&.Mui-focusVisible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main' },
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    border: 1.5,
                    borderColor: step.done ? 'success.main' : step.attention ? 'error.main' : 'divider',
                    bgcolor: step.done ? 'success.main' : 'transparent',
                    color: 'success.contrastText',
                  }}
                >
                  {step.done && <CheckRoundedIcon sx={{ fontSize: 13 }} />}
                </Box>
                <Typography
                  variant="body2"
                  sx={{ color: step.attention ? 'error.main' : step.done ? 'text.primary' : 'text.secondary', fontWeight: step.attention ? 700 : 500 }}
                >
                  {step.label}
                </Typography>
              </ButtonBase>
            </li>
          ))}
        </Box>
      </Block>
    </Paper>
  )
}
