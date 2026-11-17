import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import { getReleaseVariable } from '../services/releaseTemplateRecord.js'
import { defaultTestValue } from '../services/releaseValueFormat.js'

// Fills the PDF with values typed here (today's date and a sample amount to
// start) so the boxes can be checked on the real document before they are
// confirmed. Nothing is saved: the result lives in the browser.
export default function ReleaseTestFillDialog({ mapping, file, name, onClose }) {
  const variables = [...new Set(mapping.fields.map((field) => field.variable))]
  const [values, setValues] = useState(
    () => Object.fromEntries(variables.map((key) => [key, defaultTestValue(key)])),
  )
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // The generated PDF is a blob URL; release it when it is replaced or closed.
  const resultUrl = result?.url
  useEffect(() => () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl)
  }, [resultUrl])

  const generate = async () => {
    setStatus('working')
    setError(null)
    try {
      // The PDF library is only loaded when a fill is asked for.
      const { fillReleasePdf } = await import('../services/releasePdfFiller.js')
      const pdfBytes = new Uint8Array(await file.arrayBuffer())
      const { bytes, filled, skipped } = await fillReleasePdf({ pdfBytes, mapping, values })
      const blob = new Blob([bytes], { type: 'application/pdf' })
      setResult({ url: URL.createObjectURL(blob), filled, skipped })
      setStatus('done')
    } catch {
      setError('The PDF could not be filled. Check that the file is a valid PDF and try again.')
      setStatus('idle')
    }
  }

  const download = `${name.replace(/\.pdf$/i, '')} - test fill.pdf`

  return (
    <Dialog open fullWidth maxWidth="md" onClose={status === 'working' ? undefined : onClose} aria-labelledby="test-fill-title">
      <DialogTitle id="test-fill-title">Test fill</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Type the values to print and generate a copy of the PDF to see where
            each one lands. This copy is not saved.
          </Typography>

          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            {variables.map((key) => {
              const variable = getReleaseVariable(key)
              const isDate = variable.kind === 'date'
              return (
                <TextField
                  key={key}
                  size="small"
                  label={variable.label}
                  type={isDate ? 'date' : 'text'}
                  value={values[key]}
                  onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                  slotProps={{
                    inputLabel: isDate ? { shrink: true } : undefined,
                    input: isDate
                      ? undefined
                      : { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                  }}
                />
              )
            })}
          </Box>

          {error && <Alert severity="error">{error}</Alert>}

          {result && (
            <Stack spacing={1.5}>
              {result.skipped.length > 0 && (
                <Alert severity="warning">
                  Left blank because the value is empty or invalid:{' '}
                  {result.skipped.map((key) => getReleaseVariable(key)?.label ?? key).join(', ')}.
                </Alert>
              )}
              <Box
                component="iframe"
                src={result.url}
                title="Filled PDF preview"
                sx={{ width: '100%', height: '55vh', border: 1, borderColor: 'divider', borderRadius: 1 }}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<DownloadRoundedIcon />}
                  component="a"
                  href={result.url}
                  download={download}
                >
                  Download
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<OpenInNewRoundedIcon />}
                  component="a"
                  href={result.url}
                  target="_blank"
                  rel="noopener"
                >
                  Open in a new tab
                </Button>
              </Stack>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={status === 'working'}>Close</Button>
        <Button
          variant="contained"
          startIcon={status === 'working' ? <CircularProgress size={18} color="inherit" /> : <PlayArrowRoundedIcon />}
          disabled={status === 'working'}
          onClick={generate}
        >
          {status === 'working' ? 'Filling…' : result ? 'Fill again' : 'Fill the PDF'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
