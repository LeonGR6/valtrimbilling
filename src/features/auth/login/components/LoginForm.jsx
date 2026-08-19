import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Link, Stack } from '@mui/material'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import AuthShell, {
  AuthHeading,
  AuthTextField,
  Brand,
  submitButtonSx,
} from '../../common'
import { loginSchema } from '../schemas/login'

export default function LoginForm() {
  const { control, handleSubmit } = useForm({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = (data) => {
    // TODO: authenticate against Supabase with the validated data.
    void data
  }

  return (
    <AuthShell>
      <Brand />
      <AuthHeading title="Welcome back!" />

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Stack spacing={2}>
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
          sx={submitButtonSx}
        >
          Sign in
        </Button>
      </Box>
    </AuthShell>
  )
}
