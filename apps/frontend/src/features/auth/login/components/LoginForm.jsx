import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Link, Stack } from '@mui/material'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import AuthShell, {
  AuthHeading,
  AuthTextField,
  Brand,
  submitButtonSx,
} from '../../common'
import { loginSchema } from '../schemas/login'
import { useAuth } from '../../context/useAuth.js'
import { DEFAULT_ROUTE } from '../../../../config/appConfig.js'

export default function LoginForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const { configured, signIn } = useAuth()
  const [submitError, setSubmitError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const { control, handleSubmit } = useForm({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (data) => {
    setSubmitError(null)
    setSubmitting(true)

    try {
      await signIn(data)
      const requestedPath = location.state?.from
      const destination = typeof requestedPath === 'string' && requestedPath.startsWith('/')
        ? requestedPath
        : DEFAULT_ROUTE
      navigate(destination, { replace: true })
    } catch (error) {
      setSubmitError(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <Brand />
      <AuthHeading title="Welcome back!" />

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Stack spacing={2}>
          {!configured && (
            <Alert severity="error">
              Supabase is not configured. Add the project URL and publishable key to
              apps/frontend/.env.
            </Alert>
          )}
          {submitError && <Alert severity="error">{submitError}</Alert>}

          <Controller
            name="email"
            control={control}
            render={({ field: { ref, ...field }, fieldState }) => (
              <AuthTextField
                {...field}
                inputRef={ref}
                id="email"
                type="email"
                label="Email"
                autoComplete="username"
                icon={MailOutlineRoundedIcon}
                error={Boolean(fieldState.error)}
                helperText={fieldState.error?.message}
              />
            )}
          />

          <Controller
            name="password"
            control={control}
            render={({ field: { ref, ...field }, fieldState }) => (
              <AuthTextField
                {...field}
                inputRef={ref}
                id="password"
                label="Password"
                autoComplete="current-password"
                icon={LockOutlinedIcon}
                isPassword
                error={Boolean(fieldState.error)}
                helperText={fieldState.error?.message}
              />
            )}
          />
        </Stack>

        <Box sx={{ mt: 1.5, textAlign: 'right' }}>
          <Link
            component={RouterLink}
            to="/forgot-password"
            underline="hover"
            sx={{ color: 'text.secondary', fontSize: 13.5, fontWeight: 550 }}
          >
            Forgot your password?
          </Link>
        </Box>

        <Button
          type="submit"
          variant="contained"
          size="medium"
          fullWidth
          disableElevation
          disabled={!configured || submitting}
          sx={submitButtonSx}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </Box>
    </AuthShell>
  )
}
