import { Box, ButtonBase, Typography } from '@mui/material'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'

/**
 * What is wrong with the form, one line each. A line takes the person to its field: it scrolls to
 * it and puts the cursor there, so "Cutoff: Enter the monthly cutoff date" is one click from the
 * place where it is fixed.
 */
export default function IssueList({ items, onSelect }) {
  return (
    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.25 }}>
      {items.map((item) => (
        <li key={item.text}>
          <ButtonBase
            onClick={() => onSelect(item)}
            sx={{
              width: '100%',
              justifyContent: 'flex-start',
              alignItems: 'flex-start',
              gap: 1,
              textAlign: 'left',
              borderRadius: 1,
              px: 0.75,
              py: 0.5,
              mx: -0.75,
              '&:hover .setup-issue-text': { textDecorationColor: 'currentColor' },
              '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'error.main', outlineOffset: 1 },
            }}
          >
            <ErrorOutlineRoundedIcon sx={{ fontSize: 18, mt: '3px', color: 'error.main', flexShrink: 0 }} />
            <Typography
              className="setup-issue-text"
              variant="body2"
              sx={{
                overflowWrap: 'anywhere',
                textDecoration: 'underline',
                textDecorationColor: 'transparent',
                textUnderlineOffset: '3px',
              }}
            >
              {item.text}
            </Typography>
          </ButtonBase>
        </li>
      ))}
    </Box>
  )
}
