import { Fragment, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ConstructionRoundedIcon from '@mui/icons-material/ConstructionRounded'
import PlanToggle from '../../jobs/components/PlanToggle.jsx'
import { optionPricingSummary } from '../utils/optionPricing.js'
import { cellKey } from '../utils/priceWorksheet.js'
import WorksheetPriceField from './WorksheetPriceField.jsx'
import { jobPlansOptionsPath } from '../../jobs/utils/jobRoutes.js'
import PlanPriceCard from './PlanPriceCard.jsx'
import { hasPrice, formatPrice } from '../utils/planPriceFormat.js'
import MissingPricesChip from './MissingPricesChip.jsx'
import UndoRowButton from './UndoRowButton.jsx'
import OptionPriceValue from './OptionPriceValue.jsx'

export default function PlanPricingSheet({
  builderId,
  jobId,
  plans,
  canManage,
  submitting,
  separateHardwarePrice,
  worksheet,
  searching = false,
  onEditPlan,
  onEditHardware,
  onEditOption,
}) {
  const columnCount = separateHardwarePrice ? 6 : 5
  // Every Plan starts closed, as in Plans & options; the person opens the ones
  // they are pricing and they stay open while prices are saved.
  const [openIds, setOpenIds] = useState(() => new Set())
  // While prices are edited every Plan stays open: all the fields are in view. So do they while
  // searching, so the Options that matched can be seen.
  const isOpen = (plan) => worksheet.editing || searching || openIds.has(plan.id)
  const allOpen = plans.length > 0 && plans.every(isOpen)
  const toggle = (plan) => setOpenIds((current) => {
    const next = new Set(current)
    if (next.has(plan.id)) next.delete(plan.id)
    else next.add(plan.id)
    return next
  })
  const toggleAll = () => setOpenIds(allOpen ? new Set() : new Set(plans.map(({ id }) => id)))

  return (
    <Box data-price-sheet>
      {plans.length > 1 && !worksheet.editing && !searching && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end', px: { xs: 2, md: 1.5 }, pt: 1 }}>
          <Button size="small" color="inherit" onClick={toggleAll}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </Button>
        </Stack>
      )}

      <Stack spacing={2} sx={{ display: { xs: 'flex', md: 'none' }, p: 2 }}>
        {plans.map((plan, index) => (
          <PlanPriceCard
            key={plan.id}
            builderId={builderId}
            plan={plan}
            position={index + 1}
            jobId={jobId}
            canManage={canManage}
            submitting={submitting}
            separateHardwarePrice={separateHardwarePrice}
            expanded={isOpen(plan)}
            onToggle={worksheet.editing ? null : () => toggle(plan)}
            worksheet={worksheet}
            onEditPlan={() => onEditPlan(plan)}
            onEditHardware={() => onEditHardware(plan)}
            onEditOption={(option) => onEditOption(plan, option)}
          />
        ))}
      </Stack>

      <TableContainer sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
        <Table
          size="small"
          aria-label="Plan and option pricing worksheet"
          sx={{ minWidth: separateHardwarePrice ? 1190 : 980 }}
        >
          <TableHead>
            <TableRow
              sx={{
                bgcolor: 'action.hover',
                '& th': {
                  py: 1.25,
                  color: 'text.secondary',
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                },
              }}
            >
              <TableCell sx={{ width: 120 }}>Item</TableCell>
              <TableCell sx={{ width: 180 }}>Code</TableCell>
              <TableCell>Name / description</TableCell>
              <TableCell sx={{ width: 200 }}>Price</TableCell>
              {separateHardwarePrice && (
                <TableCell sx={{ width: 210 }}>Hardware price</TableCell>
              )}
              <TableCell align="right" sx={{ width: separateHardwarePrice ? 300 : 180 }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plans.map((plan) => {
              const planOptions = plan.options ?? []
              const hardwareIsPriced = hasPrice(plan.hardwarePrice)
              const expanded = isOpen(plan)
              // A search narrows the Options shown, not what the Plan still needs priced.
              const summary = optionPricingSummary(plan.allOptions ?? planOptions)

              return (
                <Fragment key={plan.id}>
                  <TableRow sx={{ bgcolor: 'primary.light', '& td': { py: 1.25 } }}>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', ml: -1 }}>
                        {worksheet.editing ? (
                          <Box sx={{ width: 34, flexShrink: 0 }} />
                        ) : (
                          <PlanToggle
                            plan={plan}
                            expanded={expanded}
                            onToggle={() => toggle(plan)}
                          />
                        )}
                        <Typography variant="body2" fontWeight={800} color="primary.main">
                          Plan
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography
                        component="strong"
                        variant="body1"
                        sx={{
                          display: 'inline-block',
                          color: 'text.primary',
                          fontWeight: '900 !important',
                          letterSpacing: '0.01em',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {plan.code}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                        {plan.name || `Plan ${plan.code}`}
                      </Typography>
                      {summary.complete ? (
                        !expanded && (
                          <Typography variant="caption" color="text.secondary" fontWeight={650}>
                            {summary.label}
                          </Typography>
                        )
                      ) : (
                        <Box sx={{ mt: 0.5 }}>
                          <MissingPricesChip summary={summary} />
                        </Box>
                      )}
                    </TableCell>
                    <TableCell>
                      {worksheet.editing ? (
                        <WorksheetPriceField
                          worksheet={worksheet}
                          kind="plan"
                          item={plan}
                          label={`Price of plan ${plan.code}`}
                        />
                      ) : (
                        <>
                          <Typography
                            variant="body2"
                            fontWeight={800}
                            color={hasPrice(plan.price) ? 'text.primary' : 'text.secondary'}
                          >
                            {formatPrice(plan.price)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Plan price
                          </Typography>
                        </>
                      )}
                    </TableCell>
                    {separateHardwarePrice && (
                      <TableCell>
                        {worksheet.editing ? (
                          <WorksheetPriceField
                            worksheet={worksheet}
                            kind="hardware"
                            item={plan}
                            label={`Hardware price of plan ${plan.code}`}
                          />
                        ) : (
                          <>
                            <Typography
                              variant="body2"
                              fontWeight={800}
                              color={hardwareIsPriced ? 'text.primary' : 'warning.main'}
                            >
                              {formatPrice(plan.hardwarePrice)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" component="div">
                              Additional to Plan Price
                            </Typography>
                          </>
                        )}
                      </TableCell>
                    )}
                    <TableCell align="right">
                      {worksheet.editing ? (
                        <UndoRowButton
                          worksheet={worksheet}
                          keys={[cellKey.plan(plan.id), cellKey.hardware(plan.id)]}
                          label={`Undo changes to plan ${plan.code}`}
                        />
                      ) : (
                        <Stack
                          direction="row"
                          spacing={0.75}
                          sx={{ justifyContent: 'flex-end', whiteSpace: 'nowrap' }}
                        >
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<EditOutlinedIcon />}
                            onClick={() => onEditPlan(plan)}
                            disabled={!canManage || submitting}
                            disableElevation
                          >
                            Plan price
                          </Button>
                          {separateHardwarePrice && (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<ConstructionRoundedIcon />}
                              onClick={() => onEditHardware(plan)}
                              disabled={!canManage || submitting || !hasPrice(plan.price)}
                            >
                              Hardware
                            </Button>
                          )}
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>

                  {!expanded ? null : planOptions.length > 0 ? planOptions.map((option, optionIndex) => (
                    <TableRow
                      key={option.id}
                      hover
                      sx={{
                        bgcolor: optionIndex % 2 === 0 ? 'background.paper' : 'action.hover',
                        '& td': { py: 1.15 },
                      }}
                    >
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Box sx={{ width: 14, borderTop: 1, borderColor: 'divider' }} />
                          <Typography variant="body2" color="text.secondary" fontWeight={650}>
                            Option
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          fontWeight={700}
                          sx={{
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {option.code}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                          {option.description}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {worksheet.editing ? (
                          <WorksheetPriceField
                            worksheet={worksheet}
                            kind="option"
                            item={option}
                            plan={plan}
                            label={`Price of option ${option.code}`}
                          />
                        ) : (
                          <>
                            <OptionPriceValue option={option} />
                            <Typography variant="caption" color="text.secondary" component="div">
                              Option price
                            </Typography>
                          </>
                        )}
                      </TableCell>
                      {separateHardwarePrice && (
                        <TableCell>
                          <Typography color="text.disabled">—</Typography>
                        </TableCell>
                      )}
                      <TableCell align="right">
                        {worksheet.editing ? (
                          <UndoRowButton
                            worksheet={worksheet}
                            keys={[cellKey.option(option.id)]}
                            label={`Undo changes to option ${option.code}`}
                          />
                        ) : (
                          <Button
                            size="small"
                            color="inherit"
                            startIcon={<EditOutlinedIcon />}
                            onClick={() => onEditOption(plan, option)}
                            disabled={!canManage || submitting}
                          >
                            Edit price
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow key={`${plan.id}-empty-options`}>
                      <TableCell colSpan={columnCount} sx={{ py: 1.5, bgcolor: 'background.default' }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            No Options in this Plan yet.
                          </Typography>
                          <Button
                            component={RouterLink}
                            to={jobPlansOptionsPath(builderId, jobId)}
                            size="small"
                            variant="text"
                          >
                            Manage job options
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
