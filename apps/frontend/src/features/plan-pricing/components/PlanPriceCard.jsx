import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  Stack,
  Typography,
} from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import ConstructionRoundedIcon from '@mui/icons-material/ConstructionRounded'
import PlanToggle from '../../jobs/components/PlanToggle.jsx'
import { optionPricingSummary } from '../utils/optionPricing.js'
import { cellKey } from '../utils/priceWorksheet.js'
import WorksheetPriceField from './WorksheetPriceField.jsx'
import { jobPlansOptionsPath } from '../../jobs/utils/jobRoutes.js'
import { hasPrice, formatPrice } from '../utils/planPriceFormat.js'
import MissingPricesChip from './MissingPricesChip.jsx'
import UndoRowButton from './UndoRowButton.jsx'
import OptionPriceValue from './OptionPriceValue.jsx'

export default function PlanPriceCard({
  builderId,
  plan,
  position,
  jobId,
  canManage,
  submitting,
  separateHardwarePrice,
  expanded = true,
  onToggle = null,
  worksheet = null,
  onEditPlan,
  onEditHardware,
  onEditOption,
}) {
  const options = plan.options ?? []
  const hardwareIsPriced = hasPrice(plan.hardwarePrice)
  // A search narrows the Options shown, not what the Plan still needs priced.
  const summary = optionPricingSummary(plan.allOptions ?? options)

  return (
    <Card component="article" variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          px: { xs: 2, sm: 2.5 },
          py: 2,
          bgcolor: 'primary.light',
          borderBottom: expanded ? 1 : 0,
          borderColor: 'divider',
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            {onToggle && (
              <PlanToggle
                plan={plan}
                expanded={expanded}
                onToggle={onToggle}
                controls={`plan-pricing-${plan.id}`}
              />
            )}
            <Box
              sx={{
                width: 42,
                height: 42,
                flexShrink: 0,
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontWeight: 800,
              }}
            >
              {position}
            </Box>
            <Box
              onClick={onToggle ?? undefined}
              sx={{ minWidth: 0, cursor: onToggle ? 'pointer' : 'default' }}
            >
              <Typography variant="overline" color="text.secondary" fontWeight={700}>
                Plan code {plan.code}
              </Typography>
              <Typography variant="h6" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
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
            </Box>
          </Stack>

          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <Box sx={{ minWidth: worksheet?.editing ? 170 : 130 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                Plan price
              </Typography>
              {worksheet?.editing ? (
                <WorksheetPriceField
                  worksheet={worksheet}
                  kind="plan"
                  item={plan}
                  label={`Price of plan ${plan.code}`}
                />
              ) : (
                <Typography
                  variant="h6"
                  fontWeight={800}
                  color={hasPrice(plan.price) ? 'text.primary' : 'text.secondary'}
                >
                  {formatPrice(plan.price)}
                </Typography>
              )}
            </Box>
            {separateHardwarePrice && (
              <Box sx={{ minWidth: worksheet?.editing ? 190 : 150 }}>
                <Typography variant="caption" color="text.secondary" component="div">
                  Hardware price · 100%
                </Typography>
                {worksheet?.editing ? (
                  <WorksheetPriceField
                    worksheet={worksheet}
                    kind="hardware"
                    item={plan}
                    label={`Hardware price of plan ${plan.code}`}
                  />
                ) : (
                  <Typography
                    variant="h6"
                    fontWeight={800}
                    color={hardwareIsPriced ? 'text.primary' : 'warning.main'}
                  >
                    {formatPrice(plan.hardwarePrice)}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  Additional to Plan Price
                </Typography>
              </Box>
            )}
            {worksheet?.editing ? (
              <UndoRowButton
                worksheet={worksheet}
                keys={[cellKey.plan(plan.id), cellKey.hardware(plan.id)]}
                label={`Undo changes to plan ${plan.code}`}
              />
            ) : (
              <>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<EditOutlinedIcon />}
                  onClick={onEditPlan}
                  disabled={!canManage || submitting}
                  disableElevation
                >
                  Edit plan price
                </Button>
                {separateHardwarePrice && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ConstructionRoundedIcon />}
                    onClick={onEditHardware}
                    disabled={!canManage || submitting || !hasPrice(plan.price)}
                  >
                    {hardwareIsPriced ? 'Edit hardware price' : 'Set hardware price'}
                  </Button>
                )}
              </>
            )}
          </Stack>
        </Stack>
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box id={`plan-pricing-${plan.id}`} sx={{ p: { xs: 2, sm: 2.5 } }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ mb: 1.5, alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Box>
              <Typography variant="subtitle1" fontWeight={750}>
                Pricing options
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Price for every OPT # configured under this plan.
              </Typography>
            </Box>
            <Chip
              size="small"
              variant="outlined"
              label={plan.optionCount != null && plan.optionCount !== options.length
                ? `${options.length} of ${plan.optionCount} options`
                : `${options.length} ${options.length === 1 ? 'option' : 'options'}`}
            />
          </Stack>

          {options.length > 0 ? (
            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1.5,
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  display: { xs: 'none', md: 'grid' },
                  gridTemplateColumns:
                    'minmax(150px, 0.28fr) minmax(220px, 1fr) minmax(140px, 0.24fr) auto',
                  gap: 2,
                  px: 2,
                  py: 1,
                  bgcolor: 'action.hover',
                  borderBottom: 1,
                  borderColor: 'divider',
                }}
              >
                <Typography variant="caption" color="text.secondary" fontWeight={750}>
                  OPT #
                </Typography>
                <Typography variant="caption" color="text.secondary" fontWeight={750}>
                  Description
                </Typography>
                <Typography variant="caption" color="text.secondary" fontWeight={750}>
                  Option price
                </Typography>
                <Typography variant="caption" color="text.secondary" fontWeight={750}>
                  Actions
                </Typography>
              </Box>

              {options.map((option, optionIndex) => (
                <Box
                  key={option.id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '1fr',
                      md: 'minmax(150px, 0.28fr) minmax(220px, 1fr) minmax(140px, 0.24fr) auto',
                    },
                    alignItems: { md: 'center' },
                    gap: { xs: 1.25, md: 2 },
                    px: 2,
                    py: 1.5,
                    borderTop: optionIndex === 0 ? 0 : 1,
                    borderColor: 'divider',
                    bgcolor: optionIndex % 2 === 0 ? 'background.paper' : 'action.hover',
                  }}
                >
                  <Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: { xs: 'block', md: 'none' }, mb: 0.5 }}
                    >
                      OPT #
                    </Typography>
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={option.code}
                      sx={{ fontWeight: 750, maxWidth: '100%' }}
                    />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: { xs: 'block', md: 'none' }, mb: 0.25 }}
                    >
                      Description
                    </Typography>
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      {option.description}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: { xs: 'block', md: 'none' }, mb: 0.25 }}
                    >
                      Option price
                    </Typography>
                    {worksheet?.editing ? (
                      <WorksheetPriceField
                        worksheet={worksheet}
                        kind="option"
                        item={option}
                        plan={plan}
                        label={`Price of option ${option.code}`}
                      />
                    ) : (
                      <OptionPriceValue option={option} />
                    )}
                  </Box>
                  {worksheet?.editing ? (
                    <Box sx={{ justifySelf: { xs: 'start', md: 'end' } }}>
                      <UndoRowButton
                        worksheet={worksheet}
                        keys={[cellKey.option(option.id)]}
                        label={`Undo changes to option ${option.code}`}
                      />
                    </Box>
                  ) : (
                    <Button
                      size="small"
                      color="inherit"
                      startIcon={<EditOutlinedIcon />}
                      onClick={() => onEditOption(option)}
                      disabled={!canManage || submitting}
                      sx={{ justifySelf: { xs: 'start', md: 'end' } }}
                    >
                      Edit price
                    </Button>
                  )}
                </Box>
              ))}
            </Box>
          ) : (
            <Box
              sx={{
                py: 3,
                px: 2,
                textAlign: 'center',
                border: 1,
                borderStyle: 'dashed',
                borderColor: 'divider',
                borderRadius: 1.5,
                bgcolor: 'action.hover',
              }}
            >
              <ReceiptLongRoundedIcon color="disabled" sx={{ mb: 0.5 }} />
              <Typography variant="body2" fontWeight={700}>
                No options added to this plan
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
                Add options from the Job view before assigning their prices.
              </Typography>
              <Button
                component={RouterLink}
                to={jobPlansOptionsPath(builderId, jobId)}
                size="small"
                variant="outlined"
              >
                Manage job options
              </Button>
            </Box>
          )}
        </Box>
      </Collapse>
    </Card>
  )
}
