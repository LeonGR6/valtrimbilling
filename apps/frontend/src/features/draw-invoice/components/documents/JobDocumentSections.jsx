import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  InputAdornment,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { describeReleaseDocument } from '../../../release-templates/services/releaseTemplateRecord.js'
import {
  describePaymentScheduleDocument,
  normalizeCodeKey,
} from '../../../payment-schedules/services/paymentScheduleRecord.js'
import { describePurchaseOrderDocument } from '../../../purchase-orders/services/purchaseOrderRecord.js'
import {
  jobPhaseList,
  matchesDocumentFilter,
  paymentScheduleGroups,
  purchaseOrderGroups,
  summarizeSection,
} from '../../utils/documentPhaseGroups.js'
import { formatLotRange } from '../../utils/drawPackages.js'
import DocumentRow from './DocumentRow.jsx'
import DocumentSection from './DocumentSection.jsx'
import PhaseGroupList from './PhaseGroupList.jsx'
import { DOCUMENT_TYPES } from './jobDocumentTypes.js'

const TYPE_BY_KEY = Object.fromEntries(DOCUMENT_TYPES.map((type) => [type.key, type]))

// Shorter than the card titles: they are also the labels of the shortcuts.
const TITLES = {
  'preliminary-notice': 'Preliminary notice',
  release: 'Releases',
  'payment-schedule': 'Payment schedules',
  'purchase-order': 'Purchase orders',
  backup: 'Backup documents',
}

const DOT_COLORS = {
  ok: 'success.main',
  attention: 'warning.main',
  missing: 'error.main',
  idle: 'text.disabled',
}

const TONE_CHIP_COLORS = { neutral: 'default', info: 'info', warning: 'warning', error: 'error' }

// Past this many files a section gets a filter by file name or lot.
const FILTER_FROM = 8

function unmatchedChip(item) {
  return { label: item.reason, color: TONE_CHIP_COLORS[item.tone] ?? 'default' }
}

function alsoIn(placement) {
  return placement.alsoIn.length > 0 ? `also in ${placement.alsoIn.join(', ')}` : null
}

// What a Payment Schedule's row says besides its Lots: the other Phases it is in, that
// its Phase was told by its Lots, and the Lots that could not be placed.
function scheduleNote(placement) {
  const loose = placement.looseLots
  const lots = (list) => formatLotRange(list.map(normalizeCodeKey))
  const notes = [
    alsoIn(placement),
    placement.inferred ? 'Phase deduced from its Lots' : null,
    loose.several.length > 0 ? `Lots ${lots(loose.several)} are in several Phases` : null,
    loose.unknown.length > 0 ? `Lots ${lots(loose.unknown)} are not in this Job` : null,
  ].filter(Boolean)
  return notes.length > 0 ? notes.join(' · ') : null
}

function SectionEmpty({ type, required }) {
  const isNotice = type.documentType === 'PRELIMINARY_NOTICE'
  return (
    <Box sx={{ px: 1.5, py: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {required
          ? isNotice
            ? 'Fill in the Preliminary Notice to complete this requirement.'
            : 'Upload at least one PDF to complete this requirement.'
          : type.emptyLabel}
      </Typography>
      {!required && (
        <Typography variant="caption" color="text.secondary">{type.helperText}</Typography>
      )}
    </Box>
  )
}

/**
 * The documents of one Job, one section per kind. A section opens onto its files; the
 * ones that need a look start open and the rest start closed. Payment Schedules and
 * Purchase Orders are grouped by Phase.
 */
export default function JobDocumentSections({
  job,
  documents,
  requiredTypeKeys,
  canManage,
  openingDocumentId,
  deletingDocumentId,
  releaseTemplates,
  analyzingReleaseId,
  scheduleTemplates,
  analyzingScheduleId,
  purchaseOrderAnalyses,
  analyzingPurchaseOrderId,
  purchaseOrderComparison,
  purchaseOrderLots,
  onAdd,
  onOpen,
  onDelete,
  onFillNotice,
  onReviewTemplate,
  onReviewSchedule,
  onReviewPurchaseOrder,
}) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const phone = useMediaQuery((theme) => theme.breakpoints.down('sm'))
  const [overrides, setOverrides] = useState({})
  const [filter, setFilter] = useState('')

  const phases = useMemo(() => jobPhaseList(job), [job])
  const byType = useMemo(
    () => Object.fromEntries(DOCUMENT_TYPES.map((type) => [
      type.key,
      documents.filter((document) => document.typeKey === type.key),
    ])),
    [documents],
  )
  const scheduleGroups = useMemo(
    () => paymentScheduleGroups({
      documents: byType['payment-schedule'],
      phases,
      templates: scheduleTemplates,
    }),
    [byType, phases, scheduleTemplates],
  )
  const orderGroups = useMemo(
    () => purchaseOrderGroups({
      documents: byType['purchase-order'],
      phases,
      analyses: purchaseOrderAnalyses,
      lotsByAnalysis: purchaseOrderLots,
      comparison: purchaseOrderComparison,
    }),
    [byType, phases, purchaseOrderAnalyses, purchaseOrderLots, purchaseOrderComparison],
  )
  const statuses = useMemo(
    () => Object.fromEntries(DOCUMENT_TYPES.map((type) => [
      type.key,
      summarizeSection({
        type: type.key,
        required: requiredTypeKeys.includes(type.key),
        documents: byType[type.key],
        releaseTemplates,
        scheduleGroups,
        purchaseOrderGroups: orderGroups,
      }),
    ])),
    [byType, orderGroups, releaseTemplates, requiredTypeKeys, scheduleGroups],
  )

  // What needs a look (or is missing) starts open; the rest, closed. A person's own
  // choice wins from then on.
  const isOpen = (key) => overrides[key]
    ?? (statuses[key].tone === 'attention' || statuses[key].tone === 'missing')
  const setOpen = (key, value) => setOverrides((current) => ({ ...current, [key]: value }))
  const allOpen = DOCUMENT_TYPES.every((type) => isOpen(type.key))

  const sectionId = (key) => `job-${job.id}-docs-${key}`
  const goTo = (key) => {
    setOpen(key, true)
    requestAnimationFrame(() => {
      globalThis.document.getElementById(sectionId(key))?.scrollIntoView({
        block: 'nearest',
        behavior: reduceMotion ? 'auto' : 'smooth',
      })
    })
  }

  // --- rows -------------------------------------------------------------------

  const baseRow = (document) => ({
    document,
    busyOpening: openingDocumentId === document.id,
    busyDeleting: deletingDocumentId === document.id,
    canDelete: canManage,
    onOpen,
    onDelete: (target) => onDelete(target, TYPE_BY_KEY[target.typeKey]),
  })

  const plainRow = (document) => (
    <DocumentRow key={document.id} {...baseRow(document)} />
  )

  const releaseRow = (document) => {
    const template = releaseTemplates[document.id]
    const info = describeReleaseDocument(template)
    const analyzing = analyzingReleaseId === document.id
    return (
      <DocumentRow
        key={document.id}
        {...baseRow(document)}
        chips={[
          ...(info.typeChip ? [{ label: info.typeChip.label, title: info.typeChip.title }] : []),
          ...(info.status
            ? [{ label: analyzing ? 'Analyzing…' : info.status.label, color: info.status.color }]
            : []),
        ]}
        primary={canManage || template
          ? {
            label: template && template.status !== 'failed' ? 'Review' : 'Use as template',
            ariaLabel: `Use ${document.name} as a Release template`,
            busy: analyzing,
            onClick: () => onReviewTemplate(document),
          }
          : null}
      />
    )
  }

  const scheduleRow = (document, { placement = null, unmatched = null } = {}) => {
    const template = scheduleTemplates[document.id]
    const info = describePaymentScheduleDocument(template)
    const analyzing = analyzingScheduleId === document.id
    return (
      <DocumentRow
        key={`${document.id}-${placement ? 'placed' : 'loose'}`}
        {...baseRow(document)}
        detail={placement ? `Lots ${formatLotRange(placement.lots.map(normalizeCodeKey))}` : null}
        note={placement ? scheduleNote(placement) : null}
        chips={[
          ...(info.layoutChip ? [{ label: info.layoutChip.label, title: info.layoutChip.title }] : []),
          ...(unmatched
            ? [unmatchedChip(unmatched)]
            : info.status
              ? [{ label: analyzing ? 'Analyzing…' : info.status.label, color: info.status.color }]
              : []),
        ]}
        primary={canManage || template
          ? {
            label: template && template.status !== 'failed' ? 'Review' : 'Use as schedule',
            ariaLabel: `Use ${document.name} as a Payment Schedule`,
            busy: analyzing,
            onClick: () => onReviewSchedule(document),
          }
          : null}
      />
    )
  }

  const purchaseOrderRow = (document, { placement = null, unmatched = null } = {}) => {
    const analysis = purchaseOrderAnalyses[document.id] ?? null
    const analyzing = analyzingPurchaseOrderId === document.id
    const info = describePurchaseOrderDocument(
      analysis,
      placement && placement.summary.total > 0 ? placement.summary : null,
      analyzing,
    )
    return (
      <DocumentRow
        key={`${document.id}-${placement ? 'placed' : 'loose'}`}
        {...baseRow(document)}
        detail={placement ? `Lots ${formatLotRange(placement.lots)}` : null}
        note={placement ? alsoIn(placement) : null}
        chips={unmatched
          ? [unmatchedChip(unmatched)]
          : info.status
            ? [{ label: info.status.label, color: info.status.color, title: info.title }]
            : []}
        primary={canManage || analysis
          ? {
            label: analysis && analysis.status !== 'failed' ? 'Review' : 'Analyze',
            ariaLabel: `Compare ${document.name} with the system`,
            busy: analyzing,
            onClick: () => onReviewPurchaseOrder(document),
          }
          : null}
      />
    )
  }

  // --- bodies -----------------------------------------------------------------

  const filtering = filter.trim() !== ''
  const visibleOrders = useMemo(() => {
    if (!filtering) return orderGroups
    const groups = orderGroups.groups
      .map((group) => ({
        ...group,
        placements: group.placements.filter((placement) =>
          matchesDocumentFilter(placement.document, placement.lots, filter)),
      }))
      .filter((group) => group.placements.length > 0)
    const unassigned = orderGroups.unassigned.filter((item) =>
      matchesDocumentFilter(item.document, [], filter))
    return { groups, unassigned }
  }, [filter, filtering, orderGroups])

  const bodyFor = (type) => {
    const files = byType[type.key]
    const required = requiredTypeKeys.includes(type.key)
    if (files.length === 0) return <SectionEmpty type={type} required={required} />

    switch (type.key) {
      case 'release':
        return files.map(releaseRow)

      case 'payment-schedule':
        if (scheduleGroups.flat) return files.map((document) => scheduleRow(document))
        return (
          <PhaseGroupList
            idPrefix={sectionId('ps')}
            groups={scheduleGroups.groups}
            unassigned={scheduleGroups.unassigned}
            emptyAction={canManage ? () => onAdd(type) : null}
            renderPlacement={(placement) => scheduleRow(placement.document, { placement })}
            renderUnassigned={(item) => scheduleRow(item.document, { unmatched: item })}
          />
        )

      case 'purchase-order':
        return (
          <>
            {files.length > FILTER_FROM && (
              <TextField
                size="small"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by file name or lot"
                aria-label="Filter purchase orders"
                sx={{ mb: 1, width: { xs: '100%', sm: 320 } }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchRoundedIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                  },
                }}
              />
            )}
            {filtering && visibleOrders.groups.length === 0 && visibleOrders.unassigned.length === 0
              ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1 }}>
                  No purchase order matches that filter.
                </Typography>
              )
              : (
                <PhaseGroupList
                  idPrefix={sectionId('po')}
                  groups={visibleOrders.groups}
                  unassigned={visibleOrders.unassigned}
                  forceOpen={filtering}
                  renderPlacement={(placement) => purchaseOrderRow(placement.document, { placement })}
                  renderUnassigned={(item) => purchaseOrderRow(item.document, { unmatched: item })}
                />
              )}
          </>
        )

      default:
        return files.map(plainRow)
    }
  }

  const actionFor = (type) => {
    if (!canManage) return null
    if (type.documentType === 'PRELIMINARY_NOTICE') {
      const complete = byType[type.key].some(({ isComplete }) => isComplete !== false)
      return (
        <Button
          size="small"
          variant="outlined"
          startIcon={<EditNoteRoundedIcon />}
          onClick={onFillNotice}
          sx={{ textTransform: 'none' }}
        >
          {complete ? (phone ? 'New copy' : 'Fill in another copy') : 'Fill in'}
        </Button>
      )
    }
    return (
      <Button
        size="small"
        startIcon={<AddRoundedIcon />}
        aria-label={type.addLabel}
        onClick={() => onAdd(type)}
        sx={{ textTransform: 'none' }}
      >
        Add
      </Button>
    )
  }

  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}
      >
        {DOCUMENT_TYPES.map((type) => (
          <Chip
            key={type.key}
            clickable
            variant="outlined"
            onClick={() => goTo(type.key)}
            aria-label={`Go to ${TITLES[type.key]}: ${statuses[type.key].badge?.label ?? 'optional, none yet'}`}
            label={TITLES[type.key]}
            icon={(
              <Box
                aria-hidden="true"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: DOT_COLORS[statuses[type.key].tone],
                  ml: '10px !important',
                }}
              />
            )}
          />
        ))}
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          color="inherit"
          sx={{ textTransform: 'none' }}
          onClick={() => setOverrides(Object.fromEntries(
            DOCUMENT_TYPES.map((type) => [type.key, !allOpen]),
          ))}
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Button>
      </Stack>

      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
        {DOCUMENT_TYPES.map((type) => (
          <DocumentSection
            key={type.key}
            id={sectionId(type.key)}
            title={TITLES[type.key]}
            status={statuses[type.key]}
            open={isOpen(type.key)}
            onToggle={() => setOpen(type.key, !isOpen(type.key))}
            action={actionFor(type)}
          >
            {bodyFor(type)}
          </DocumentSection>
        ))}
      </Box>
    </Box>
  )
}
