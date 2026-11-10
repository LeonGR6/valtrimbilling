import {
  Box,
  Button,
  Card,
  Skeleton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material'
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded'
import PostAddRoundedIcon from '@mui/icons-material/PostAddRounded'
import { CHANGE_ORDERS_ENABLED } from '../../../../config/appConfig.js'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import { PACKAGE_CATALOG_TABS } from '../../utils/packageCatalog.js'
import {
  PACKAGE_TABLE_COLUMNS,
  PACKAGE_TABLE_MIN_WIDTH,
} from '../../utils/packageTableColumns.js'

// What the pages show while their Packages load. Each one keeps the real page's proportions
// (the same header, cards, columns and panels), so nothing moves when the data arrives. What is
// always the same (titles, tab names, column headings) is real text; only the data is a bone.

const LOADING_LABEL = 'Loading Draw & Invoice Packages…'

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
}

// One placeholder for a piece of data. The pulse stops for people who ask for less motion.
function Bone({ width, height = 16, pill = false, sx }) {
  return (
    <Skeleton
      aria-hidden="true"
      variant="rounded"
      width={width}
      height={height}
      sx={{
        maxWidth: '100%',
        borderRadius: pill ? 99 : 1,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        ...sx,
      }}
    />
  )
}

// The page announces once that it is loading; the bones themselves say nothing.
function LoadingRegion({ children }) {
  return (
    <Box role="status" aria-busy="true" sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box component="span" sx={visuallyHidden}>{LOADING_LABEL}</Box>
      {children}
    </Box>
  )
}

const headerBandSx = {
  px: { xs: 2, md: 3 },
  bgcolor: 'background.paper',
  borderBottom: 1,
  borderColor: 'divider',
}

const panelSx = {
  bgcolor: 'background.paper',
  border: 1,
  borderColor: 'divider',
  borderRadius: 2,
  overflow: 'hidden',
}

// Rows are not all the same width, so the table reads as text and not as a barcode.
const ROW_WIDTHS = [1, 0.84, 0.94, 0.72, 0.9, 0.8, 0.96, 0.76]

// What each column of a Package row holds, as [width %, height, pill?] for its lines.
const CELL_LINES = {
  package: [[72, 16], [52, 12], [62, 12]],
  status: [[72, 24, true]],
  quickbooks: [[74, 16], [52, 12]],
  builder: [[78, 16], [56, 12]],
  'billing-period': [[80, 16], [58, 12]],
  lots: [[56, 16]],
  'current-draw': [[70, 16], [48, 12]],
  'retention-wrap': [[72, 16], [60, 12]],
  'invoice-amount': [[76, 18]],
  documents: [[70, 24, true]],
  action: [[64, 30]],
}

const SUMMARY_CARD_COUNT = 4

function SummaryCardSkeleton() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        minWidth: 0,
        minHeight: 62,
        px: 1.5,
        py: 1,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
      }}
    >
      <Bone width={34} height={34} sx={{ flexShrink: 0, borderRadius: 1.5 }} />
      <Stack spacing={0.75} sx={{ minWidth: 0, flex: 1 }}>
        <Bone width="62%" height={20} />
        <Bone width="86%" height={12} />
      </Stack>
    </Box>
  )
}

export function PackageCatalogSkeleton() {
  return (
    <LoadingRegion>
      <Box sx={{ ...headerBandSx, pt: 1.5 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 3, rowGap: 0.5 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" component="h1" fontWeight={800} letterSpacing="-0.01em" sx={{ lineHeight: 1.2 }}>
              Draw & Invoice
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
              Review active Packages by status and manage their billing workflow.
            </Typography>
          </Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{ ml: 'auto', alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
          >
            <Bone width={132} height={36} />
            <Bone width={148} height={36} />
            <Bone width={118} height={36} />
          </Stack>
        </Stack>
        <Tabs
          value="packages"
          aria-hidden="true"
          sx={{ mt: 0.5, minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0 } }}
        >
          <Tab value="packages" disabled icon={<ReceiptLongRoundedIcon />} iconPosition="start" label="Packages" />
          <Tab value="documents" disabled icon={<FolderOpenRoundedIcon />} iconPosition="start" label="Documents" />
          <Tab value="ar" disabled icon={<AccountBalanceWalletRoundedIcon />} iconPosition="start" label="A/R" />
          {CHANGE_ORDERS_ENABLED && (
            <Tab value="co" disabled icon={<PostAddRoundedIcon />} iconPosition="start" label="Change Orders" />
          )}
        </Tabs>
      </Box>

      <Stack spacing={1.5} sx={{ p: { xs: 2, md: 3 } }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 1.5,
          }}
        >
          {Array.from({ length: SUMMARY_CARD_COUNT }, (_, index) => (
            <SummaryCardSkeleton key={index} />
          ))}
        </Box>

        <Box sx={panelSx}>
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            sx={{ alignItems: { lg: 'center' } }}
          >
            <Tabs
              value="ALL"
              variant="scrollable"
              aria-hidden="true"
              sx={{
                flexShrink: 0,
                minHeight: 44,
                px: 1,
                maxWidth: '100%',
                borderBottom: { xs: 1, lg: 0 },
                borderColor: 'divider',
                '& .MuiTab-root': { minHeight: 44, py: 0 },
              }}
            >
              {PACKAGE_CATALOG_TABS.map(({ value, label }) => (
                <Tab key={value} value={value} disabled label={label} />
              ))}
            </Tabs>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1}
              sx={{ flex: 1, minWidth: 0, p: 1, alignItems: { md: 'center' } }}
            >
              <Bone height={40} sx={{ flex: { md: 2 }, minWidth: { md: 200 }, width: { xs: '100%', md: 'auto' } }} />
              <Bone height={40} sx={{ flex: { md: 1 }, minWidth: { md: 150 }, width: { xs: '100%', md: 'auto' } }} />
              <Bone height={40} sx={{ flex: { md: 1 }, minWidth: { md: 150 }, width: { xs: '100%', md: 'auto' } }} />
              <Bone width={104} height={36} sx={{ flexShrink: 0 }} />
            </Stack>
          </Stack>
        </Box>

        <Box sx={panelSx}>
          <TableContainer>
            <Table
              sx={{
                minWidth: PACKAGE_TABLE_MIN_WIDTH,
                tableLayout: 'fixed',
                '& .MuiTableCell-root': { px: 1.5, py: 1.1, verticalAlign: 'top' },
                '& .MuiTableCell-head': { py: 0.9 },
                '& tbody tr:last-of-type .MuiTableCell-root': { borderBottom: 0 },
              }}
            >
              <colgroup>
                {PACKAGE_TABLE_COLUMNS.map((column) => (
                  <col key={column.key} style={{ width: column.width }} />
                ))}
              </colgroup>
              <TableHead>
                <TableRow
                  sx={{
                    bgcolor: 'sidebar.bg',
                    '& .MuiTableCell-root': {
                      color: 'text.secondary',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    },
                  }}
                >
                  {PACKAGE_TABLE_COLUMNS.map((column) => (
                    <TableCell key={column.key}>{column.label}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {ROW_WIDTHS.map((factor, row) => (
                  <TableRow key={row} aria-hidden="true">
                    {PACKAGE_TABLE_COLUMNS.map((column) => (
                      <TableCell key={column.key}>
                        <Stack spacing={0.75}>
                          {CELL_LINES[column.key].map(([width, height, pill], line) => (
                            <Bone
                              key={line}
                              width={`${Math.round(width * factor)}%`}
                              height={height}
                              pill={pill}
                            />
                          ))}
                        </Stack>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Stack>
    </LoadingRegion>
  )
}

const SUMMARY_FACT_COUNT = 3
const SUMMARY_LINE_COUNT = 3
const WORKSHEET_COLUMNS = [34, 14, 14, 14, 14, 10]
const WORKSHEET_ROW_COUNT = 6

// The summary panel of a Package: what it covers on the left, the amounts as a ledger on the
// right (each joined to its label by a dotted leader), with the Invoice Amount closing it.
function SummaryPanelSkeleton() {
  return (
    <Card variant="outlined">
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(340px, 440px)' },
        }}
      >
        <Box
          sx={{
            p: { xs: 2, md: 2.5 },
            display: 'flex',
            flexWrap: 'wrap',
            alignContent: 'flex-start',
            columnGap: { xs: 4, md: 6 },
            rowGap: 2,
          }}
        >
          {Array.from({ length: SUMMARY_FACT_COUNT }, (_, index) => (
            <Stack key={index} spacing={0.75}>
              <Bone width={88} height={14} />
              <Bone width={64} height={34} />
            </Stack>
          ))}
        </Box>
        <Box
          sx={{
            p: { xs: 2, md: 2.5 },
            borderTop: { xs: '1px solid', md: 0 },
            borderLeft: { md: '1px solid' },
            borderTopColor: 'divider',
            borderLeftColor: 'divider',
            bgcolor: 'action.hover',
          }}
        >
          <Stack spacing={1.25}>
            {Array.from({ length: SUMMARY_LINE_COUNT }, (_, index) => (
              <Stack key={index} direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <Bone width={76} height={14} />
                <Box
                  aria-hidden="true"
                  sx={{ flex: 1, minWidth: 16, borderBottom: '1px dotted', borderBottomColor: 'divider' }}
                />
                <Bone width={72} height={14} />
              </Stack>
            ))}
          </Stack>
          <Stack
            direction="row"
            sx={{ mt: 1.5, pt: 1.5, alignItems: 'center', justifyContent: 'space-between', borderTop: 1, borderColor: 'divider' }}
          >
            <Bone width={112} height={20} />
            <Bone width={104} height={28} />
          </Stack>
        </Box>
      </Box>
    </Card>
  )
}

function WorksheetSkeleton() {
  return (
    <Card variant="outlined">
      <Stack
        direction="row"
        sx={{ p: 2, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}
      >
        <Bone width={168} height={22} />
        <Bone width={112} height={32} />
      </Stack>
      <Stack sx={{ px: 2 }}>
        {Array.from({ length: WORKSHEET_ROW_COUNT }, (_, row) => (
          <Stack
            key={row}
            direction="row"
            spacing={2}
            sx={{
              py: 1.5,
              alignItems: 'center',
              borderBottom: row === WORKSHEET_ROW_COUNT - 1 ? 0 : 1,
              borderColor: 'divider',
            }}
          >
            {WORKSHEET_COLUMNS.map((share, column) => (
              <Box
                key={column}
                sx={{ flex: share, minWidth: 0, display: { xs: column < 3 ? 'block' : 'none', md: 'block' } }}
              >
                <Bone width={`${Math.round((column === 0 ? 70 : 60) * ROW_WIDTHS[row % ROW_WIDTHS.length])}%`} height={16} />
              </Box>
            ))}
          </Stack>
        ))}
      </Stack>
    </Card>
  )
}

export function DrawPackageDetailSkeleton({ onBack }) {
  return (
    <LoadingRegion>
      <Box sx={{ ...headerBandSx, pt: 1, pb: 2 }}>
        <Button
          color="inherit"
          size="small"
          startIcon={<ArrowBackRoundedIcon />}
          onClick={onBack}
          sx={{ ml: -1, mb: 1, color: 'text.secondary' }}
        >
          All packages
        </Button>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'flex-start' }, justifyContent: 'space-between' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Bone width={210} height={16} />
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', height: 40, mt: 0.25 }}>
              <Bone width={176} height={28} />
              <Bone width={104} height={30} pill />
            </Stack>
            <Bone width={340} height={16} sx={{ mt: 0.75 }} />
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0, alignItems: 'center' }}>
            <Bone width={148} height={40} />
            <Bone width={112} height={36} />
            <Bone width={36} height={36} />
          </Stack>
        </Stack>
      </Box>

      <Stack spacing={2} sx={{ p: { xs: 2, md: 3 } }}>
        <SummaryPanelSkeleton />
        <WorksheetSkeleton />
      </Stack>
    </LoadingRegion>
  )
}
