import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Stack } from '@mui/material'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import LockResetRoundedIcon from '@mui/icons-material/LockResetRounded'
import AuthShell, {
  AuthHeading,
  AuthTextField,
  Brand,
  submitButtonSx,
} from '../../common'
import { resetPasswordSchema } from '../schemas/resetPassword'
import { DEFAULT_ROUTE } from '../../../../config/appConfig.js'
import { useAuth } from '../../useAuth.js'
import { supabase } from '../../../../services/api.js'

export default function ResetPasswordForm() {
  const navigate = useNavigate()
  const { session, loading: sessionLoading } = useAuth()
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const { control, handleSubmit } = useForm({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onTouched',
    defaultValues: { password: '', confirm: '' },
  })

  const onSubmit = async ({ password }) => {
    setSubmitting(true)
    setSubmitError(null)

    const { error } = await supabase.auth.updateUser({ password })

    setSubmitting(false)
    if (error) {
      setSubmitError(error.message)
      return
    }

    setDone(true)
  }

  if (done) {
    return (
      <AuthShell>
        <Brand />
        <AuthHeading
          title="Password updated"
          subtitle="Your password is ready. Continue to the application."
        />
        <Stack spacing={3} sx={{ alignItems: 'center' }}>
          <Box
            aria-hidden="true"
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 56,
              height: 56,
              borderRadius: '50%',
              color: 'success.main',
              bgcolor: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'rgba(34, 197, 94, 0.14)'
                  : 'rgba(34, 197, 94, 0.10)',
            }}
          >
            <CheckCircleOutlineRoundedIcon sx={{ fontSize: 30 }} />
          </Box>
          <Button
            variant="contained"
            size="medium"
            fullWidth
            disableElevation
            onClick={() => navigate(DEFAULT_ROUTE, { replace: true })}
            sx={submitButtonSx}
          >
            Continue
          </Button>
        </Stack>
      </AuthShell>
    )
  }

  if (sessionLoading) {
    return (
      <AuthShell>
        <Brand />
        <AuthHeading
          title="Checking link…"
          subtitle="We are validating your invitation or recovery link."
        />
      </AuthShell>
    )
  }

  if (!session) {
    return (
      <AuthShell>
        <Brand />
        <AuthHeading
          title="Link unavailable"
          subtitle="This link is invalid, expired, or has already been used."
        />
        <Button
          variant="contained"
          fullWidth
          disableElevation
          onClick={() => navigate('/login', { replace: true })}
          sx={submitButtonSx}
        >
          Go to sign in
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <Brand />
      <AuthHeading
        title="New password"
        subtitle="Choose a secure password for your account."
      />

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Stack spacing={2}>
          {submitError && <Alert severity="error">{submitError}</Alert>}
          <Controller
            name="password"
            control={control}
            render={({ field: { ref, ...field }, fieldState }) => (
              <AuthTextField
                {...field}
                inputRef={ref}
                id="password"
                label="New password"
                autoComplete="new-password"
                icon={LockResetRoundedIcon}
                isPassword
                error={Boolean(fieldState.error)}
                helperText={fieldState.error?.message}
              />
            )}
          />

          <Controller
            name="confirm"
            control={control}
            render={({ field: { ref, ...field }, fieldState }) => (
              <AuthTextField
                {...field}
                inputRef={ref}
                id="confirm"
                label="Confirm password"
                autoComplete="new-password"
                icon={LockOutlinedIcon}
                isPassword
                error={Boolean(fieldState.error)}
                helperText={fieldState.error?.message}
              />
            )}
          />
        </Stack>

        <Button
          type="submit"
          variant="contained"
          size="medium"
          fullWidth
          disableElevation
          disabled={submitting}
          sx={submitButtonSx}
        >
          {submitting ? 'Saving…' : 'Save password'}
        </Button>
      </Box>
    </AuthShell>
  )
}
