import { useState } from 'react'
import {
  Box,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import ColorModeToggle from '../../../../components/common/ColorModeToggle'
import valtrimLogoDark from '../../../../assets/icons/Valtrim-White-Transparent.png'
import valtrimLogoLight from '../../../../assets/icons/Valtrim-Blue-Transparent.png'

// Solid field background: same color in normal and autofilled states,
// so Chrome's autofill doesn't leave a different tone over the gradient.
const fieldBg = (theme) =>
  theme.palette.mode === 'dark'
    ? theme.palette.background.default
    : theme.palette.background.paper

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    minHeight: 50,
    borderRadius: 2,
    bgcolor: fieldBg,
    '& fieldset': { borderColor: 'divider' },
    '&:hover fieldset': { borderColor: 'text.secondary' },
    // Keep the red outline in the error state (wins over the rules above).
    '&.Mui-error fieldset, &.Mui-error:hover fieldset': {
      borderColor: 'error.main',
    },
  },
  // The field's real height comes from this padding, not from minHeight.
  '& .MuiOutlinedInput-input': {
    paddingTop: '12.5px',
    paddingBottom: '12.5px',
  },
  '& .MuiInputLabel-root:not(.MuiInputLabel-shrink)': {
    transform: 'translate(49px, 14px) scale(1)',
  },
  '& input:-webkit-autofill': {
    WebkitBoxShadow: (theme) => `0 0 0 100px ${fieldBg(theme)} inset`,
    WebkitTextFillColor: (theme) => theme.palette.text.primary,
    caretColor: (theme) => theme.palette.text.primary,
    // Fires an animationstart event that React listens for to detect that
    // Chrome autofilled the field (there's no other way it notifies us).
    animationName: 'onAutoFillStart',
    animationDuration: '0.001s',
  },
  '@keyframes onAutoFillStart': { from: { opacity: 1 }, to: { opacity: 1 } },
}

// Style for the primary button across the auth screens.
export const submitButtonSx = {
  minHeight: 42,
  mt: 3,
  borderRadius: 2,
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.01em',
  textTransform: 'none',
  boxShadow: '0 6px 16px rgba(59, 130, 246, 0.28)',
  transition: 'transform 160ms ease, box-shadow 160ms ease',
  '&:hover': {
    transform: 'translateY(-1px)',
    boxShadow: '0 10px 22px rgba(59, 130, 246, 0.36)',
  },
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
}

// Reusable text field: internally manages focus, autofill detection
// (to float the label) and the show/hide password toggle.
export function AuthTextField({
  id,
  name,
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  inputRef,
  autoComplete,
  icon: Icon,
  isPassword = false,
  error = false,
  helperText,
}) {
  const [focused, setFocused] = useState(false)
  const [autofilled, setAutofilled] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const handleAnimationStart = (event) => {
    if (event.animationName === 'onAutoFillStart') setAutofilled(true)
  }

  const resolvedType = isPassword ? (showPassword ? 'text' : 'password') : type

  return (
    <TextField
      id={id}
      name={name}
      type={resolvedType}
      label={label}
      value={value}
      onChange={(event) => {
        onChange(event)
        setAutofilled(false)
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        setFocused(false)
        onBlur?.(event)
      }}
      inputRef={inputRef}
      autoComplete={autoComplete}
      error={error}
      helperText={helperText}
      fullWidth
      slotProps={{
        inputLabel: { shrink: focused || Boolean(value) || autofilled },
        htmlInput: { onAnimationStart: handleAnimationStart },
        input: {
          startAdornment: Icon ? (
            <InputAdornment position="start">
              <Icon
                aria-hidden="true"
                sx={{
                  color: focused ? 'primary.main' : 'text.secondary',
                  fontSize: 19,
                }}
              />
            </InputAdornment>
          ) : undefined,
          endAdornment: isPassword ? (
            <InputAdornment position="end">
              <IconButton
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                edge="end"
                onClick={() => setShowPassword((visible) => !visible)}
                onMouseDown={(event) => event.preventDefault()}
                sx={{ color: 'text.secondary' }}
              >
                {showPassword ? (
                  <VisibilityOffOutlinedIcon sx={{ fontSize: 20 }} />
                ) : (
                  <VisibilityOutlinedIcon sx={{ fontSize: 20 }} />
                )}
              </IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
      sx={fieldSx}
    />
  )
}

// Central brand (large logo + name) that heads each screen.
export function Brand() {
  const theme = useTheme()
  const logo = theme.palette.mode === 'dark' ? valtrimLogoDark : valtrimLogoLight

  return (
    <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center' }}>
      <Box
        component="img"
        src={logo}
        alt="Valtrim"
        sx={{
          height: 58,
          width: 'auto',
          filter: 'drop-shadow(0 10px 18px rgba(59, 130, 246, 0.22))',
        }}
      />
      <Typography
        sx={{
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: '0.18em',
          lineHeight: 1.2,
          textTransform: 'uppercase',
        }}
      >
        Valtrim Inc.
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: 13.5 }}>
        Valtrim Billing workspace
      </Typography>
    </Stack>
  )
}

// Compact brand for the top-left corner.
function CornerBrand() {
  const theme = useTheme()
  const logo = theme.palette.mode === 'dark' ? valtrimLogoDark : valtrimLogoLight

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box
        component="img"
        src={logo}
        alt=""
        aria-hidden="true"
        sx={{ height: 30, width: 'auto' }}
      />
      <Typography
        sx={{
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: '-0.01em',
          color: 'text.primary',
        }}
      >
        Valtrim
      </Typography>
    </Stack>
  )
}

// Title + optional subtitle, with consistent spacing across all screens.
export function AuthHeading({ title, subtitle }) {
  return (
    <Box sx={{ mt: { xs: 4, sm: 4.5 }, mb: { xs: 3.25, sm: 3.75 }, textAlign: 'center' }}>
      <Typography
        component="h1"
        sx={{
          fontSize: { xs: 30, sm: 34 },
          fontWeight: 750,
          letterSpacing: '-0.04em',
          lineHeight: 1.15,
        }}
      >
        {title}
      </Typography>
      {subtitle && (
        <Typography
          sx={{ mt: 1.5, color: 'text.secondary', fontSize: 14, lineHeight: 1.5 }}
        >
          {subtitle}
        </Typography>
      )}
    </Box>
  )
}

// Shared container: gradient background, corner brand, theme toggle and the
// central block where each screen inserts its content.
export default function AuthShell({ children }) {
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: (theme) =>
          theme.palette.mode === 'dark'
            ? 'radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.24) 0%, rgba(59, 130, 246, 0.06) 34%, transparent 58%), linear-gradient(180deg, #233756 0%, #111d34 48%, #070e1a 100%)'
            : 'radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.16) 0%, transparent 54%), linear-gradient(180deg, #ffffff 0%, #f5f8ff 48%, #e7effc 100%)',
        px: 3,
        py: { xs: 4, sm: 6 },
      }}
    >
      <Box sx={{ position: 'absolute', top: { xs: 18, sm: 28 }, left: { xs: 18, sm: 28 } }}>
        <CornerBrand />
      </Box>

      <Box sx={{ position: 'absolute', top: { xs: 18, sm: 28 }, right: { xs: 18, sm: 28 } }}>
        <ColorModeToggle />
      </Box>

      <Box component="section" sx={{ width: '100%', maxWidth: 350 }}>
        {children}
      </Box>
    </Box>
  )
}
