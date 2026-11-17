import { Accordion, AccordionDetails, AccordionSummary, Stack, Typography } from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'

/**
 * What an earlier Package already billed, kept out of the way under the part still to choose:
 * closed until opened, with its count on the closed bar. `nouns` is what is counted, singular
 * and plural ("option", "options"); `children` is the table of those rows.
 */
export default function BilledRowsAccordion({ count, nouns, children }) {
  if (count === 0) return null

  return (
    <Accordion
      disableGutters
      square
      elevation={0}
      sx={{ borderTop: 1, borderColor: 'divider', '&:before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <CheckCircleRoundedIcon color="success" fontSize="small" />
          <Typography fontWeight={750}>
            {count} {count === 1 ? nouns[0] : nouns[1]} already billed
          </Typography>
          <Typography variant="body2" color="text.secondary">
            In earlier Packages, nothing to choose here
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>{children}</AccordionDetails>
    </Accordion>
  )
}
