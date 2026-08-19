import { useColorScheme } from '@mui/material/styles'
import { IconButton, Tooltip } from '@mui/material'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'

export default function ColorModeToggle() {
  const { mode, systemMode, setMode } = useColorScheme()

  // mode is undefined on the first render until the scheme is resolved.
  if (!mode) return null

  const resolved = mode === 'system' ? systemMode : mode
  const next = resolved === 'dark' ? 'light' : 'dark'

  return (
    <Tooltip title={`Switch to ${next} mode`}>
      <IconButton onClick={() => setMode(next)} size="small" sx={{ color: 'text.secondary' }}>
        {resolved === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  )
}
