import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { Box, Button, Stack } from '@mui/material'
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

export default function ResetPasswordForm() {
  const navigate = useNavigate()
  const [done, setDone] = useState(false)
  const { control, handleSubmit } = useForm({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onTouched',
    defaultValues: { password: '', confirm: '' },
  })

  const onSubmit = () => {
    // TODO: update the password through Supabase.
    setDone(true)
  }

  if (done) {
    return (
      <AuthShell>
        <Brand />
        <AuthHeading
          title="Password updated"
          subtitle="You can now sign in with your new password."
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
            onClick={() => navigate('/login')}
            sx={submitButtonSx}
          >
            Go to sign in
          </Button>
        </Stack>
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
          sx={submitButtonSx}
        >
          Reset password
        </Button>
      </Box>
    </AuthShell>
  )
}
