import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'

function FilePreview({ name, mimeType = 'application/pdf', viewUrl, downloadUrl = viewUrl }) {
  const [displayError, setDisplayError] = useState(false)
  const isPdf = mimeType === 'application/pdf'
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{name}</Typography>
      {(!displayError || isPdf) && <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button component="a" href={viewUrl} target="_blank" rel="noopener noreferrer"
          variant="outlined" size="small" startIcon={<OpenInNewRoundedIcon />}>
          Open {isPdf ? 'PDF' : 'image'} in new tab
        </Button>
        <Button component="a" href={downloadUrl} download={name || 'source.pdf'}
          variant="outlined" size="small" startIcon={<DownloadRoundedIcon />}>Download file</Button>
      </Stack>}
      {displayError && <Alert severity="warning">{isPdf
        ? 'The PDF could not be displayed. Refresh access, open it in a new tab or download it.'
        : 'The original image is unavailable or could not be displayed. It may have been deleted or access may have expired. Any retained extraction remains available. Refresh access to try again.'}</Alert>}
      {!displayError && (isPdf ? (
        <>
          <Typography variant="caption" color="text.secondary">
            If your browser does not display the PDF, open it in a new tab or download it.
          </Typography>
          <Box component="iframe" src={viewUrl} title="Original source PDF" onError={() => setDisplayError(true)}
            sx={{ width: '100%', height: { xs: '55vh', sm: '60vh' }, minHeight: 320,
              border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: '#fff' }} />
        </>
      ) : (
        <Box component="img" src={viewUrl} alt={name || 'Original email attachment'}
          onError={() => setDisplayError(true)}
          sx={{ display: 'block', width: '100%', maxHeight: '65vh', objectFit: 'contain', borderRadius: 1 }} />
      ))}
    </Stack>
  )
}

export function SessionSourceFilePreview({ file }) {
  const url = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <FilePreview name={file.name} viewUrl={url} />
}

export default function SourceFilePreview({ loadUrls, fallbackFile = null }) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const refresh = () => { setResult(null); setError(''); setAttempt((value) => value + 1) }

  useEffect(() => {
    let active = true
    let expiryTimer
    Promise.resolve().then(loadUrls).then((data) => {
      if (!active) return
      setResult(data)
      // Renew while the selected viewer is open. No signed URL is persisted.
      if (Number.isFinite(data.expiresIn) && data.expiresIn > 0) {
        expiryTimer = setTimeout(() => {
          setResult(null)
          setError('')
          setAttempt((value) => value + 1)
        }, Math.max(1000, (data.expiresIn - Math.min(15, data.expiresIn / 2)) * 1000))
      }
    }).catch((failure) => {
      if (active) setError(failure?.message || 'The private file could not be opened.')
    })
    return () => { active = false; clearTimeout(expiryTimer) }
  }, [loadUrls, attempt])

  return (
    <Stack spacing={1.5}>
      {error ? (
        <>
          <Alert severity="error" action={<Button color="inherit" onClick={refresh}>Retry opening</Button>}>{error}</Alert>
          {fallbackFile && <><Alert severity="info">The in-session copy is shown below.</Alert><SessionSourceFilePreview file={fallbackFile} /></>}
        </>
      ) : result ? (
        <>
          <Button size="small" variant="outlined" onClick={refresh} sx={{ alignSelf: 'flex-start' }}>Refresh access</Button>
          <FilePreview key={result.signedUrl} name={result.originalFilename} mimeType={result.mimeType}
            viewUrl={result.signedUrl} downloadUrl={result.downloadUrl} />
        </>
      ) : (
        <Stack role="status" direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 3 }}>
          <CircularProgress size={22} /><Typography variant="body2">Opening the private source file…</Typography>
        </Stack>
      )}
    </Stack>
  )
}
