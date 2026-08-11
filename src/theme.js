import { createTheme } from '@mui/material/styles'

// Light + dark color schemes. All colors live here so components stay
// theme-aware (no hardcoded hex) and adapt automatically to the mode.
const theme = createTheme({
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#2563EB', light: '#EFF6FF' },
        error: { main: '#DC2626' },
        text: { primary: '#1E293B', secondary: '#64748B' },
        // default = canvas behind the floating content panel; paper = the panel
        background: { default: '#F8FAFC', paper: '#FFFFFF' },
        divider: '#E2E8F0',
        sidebar: { bg: '#F8FAFC', hover: '#F1F5F9' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#3B82F6', light: 'rgba(59, 130, 246, 0.18)' },
        error: { main: '#EF4444' },
        text: { primary: '#F1F5F9', secondary: '#94A3B8' },
        // default = canvas behind the floating content panel; paper = the panel
        background: { default: '#0F172A', paper: '#1E293B' },
        divider: '#334155',
        sidebar: { bg: '#0F172A', hover: '#334155' },
      },
    },
  },
  typography: {
    fontFamily:
      "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  shape: { borderRadius: 8 },
})

export default theme
