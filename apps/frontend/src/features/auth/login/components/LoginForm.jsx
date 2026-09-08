import { useEffect, useState } from 'react'
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
import { DEFAULT_ROUTE } from '../../../../config/appConfig.js'
import { useAuth } from '../../useAuth.js'
import { supabase } from '../../../../services/api.js'

export default function LoginForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const { session, loading: sessionLoading } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const { control, handleSubmit } = useForm({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  })

  const destination = location.state?.from || DEFAULT_ROUTE

  useEffect(() => {
    if (!sessionLoading && session) navigate(destination, { replace: true })
  }, [destination, navigate, session, sessionLoading])

  const onSubmit = async (data) => {
    setSubmitting(true)
    setSubmitError(null)

    const { error } = await supabase.auth.signInWithPassword(data)

    if (error) {
      setSubmitError(
        error.code === 'invalid_credentials'
          ? 'Email or password is incorrect.'
          : error.message,
      )
      setSubmitting(false)
      return
    }

    navigate(destination, { replace: true })
  }

  return (
    <AuthShell>
      <Brand />
      <AuthHeading title="Welcome back!" />

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Stack spacing={2}>
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
          disabled={submitting || sessionLoading}
          sx={submitButtonSx}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </Box>
    </AuthShell>
  )
}
