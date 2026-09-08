import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link as RouterLink } from 'react-router-dom'
import { Alert, Box, Button, Link, Stack } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined'
import AuthShell, {
  AuthHeading,
  AuthTextField,
  Brand,
  submitButtonSx,
} from '../../common'
import { forgotPasswordSchema } from '../schemas/forgotPassword'
import { useAuth } from '../../context/useAuth.js'

export default function ForgotPasswordForm() {
  const { configured, requestPasswordReset } = useAuth()
  const [submittedEmail, setSubmittedEmail] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const { control, handleSubmit } = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  })

  const onSubmit = async (data) => {
    setSubmitError(null)
    setSubmitting(true)

    try {
      await requestPasswordReset(data.email)
      setSubmittedEmail(data.email)
    } catch (error) {
      setSubmitError(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <Brand />

      {submittedEmail ? (
        <>
          <AuthHeading
            title="Check your inbox"
            subtitle={`If an account exists for ${submittedEmail}, we've sent a link to reset your password.`}
          />
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <Box
              aria-hidden="true"
              sx={{
                display: 'grid',
                placeItems: 'center',
                width: 56,
                height: 56,
                borderRadius: '50%',
                color: 'primary.main',
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(59, 130, 246, 0.14)'
                    : 'rgba(59, 130, 246, 0.10)',
              }}
            >
              <MarkEmailReadOutlinedIcon sx={{ fontSize: 28 }} />
            </Box>
            <Button
              type="button"
              variant="text"
              onClick={() => setSubmittedEmail(null)}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Use a different email
            </Button>
          </Stack>
        </>
      ) : (
        <>
          <AuthHeading
            title="Forgot password?"
            subtitle="Enter your email and we'll send you a link to reset your password."
          />
          <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
            {!configured && (
              <Alert severity="error" sx={{ mb: 2 }}>
                Supabase is not configured. Add the project URL and publishable key to
                apps/frontend/.env.
              </Alert>
            )}
            {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}

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

            <Button
              type="submit"
              variant="contained"
              size="medium"
              fullWidth
              disableElevation
              disabled={!configured || submitting}
              sx={submitButtonSx}
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </Button>
          </Box>
        </>
      )}

      <Box sx={{ mt: 3, textAlign: 'center' }}>
        <Link
          component={RouterLink}
          to="/login"
          underline="hover"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            color: 'text.secondary',
            fontSize: 13.5,
            fontWeight: 550,
          }}
        >
          <ArrowBackRoundedIcon sx={{ fontSize: 17 }} />
          Back to sign in
        </Link>
      </Box>
    </AuthShell>
  )
}
