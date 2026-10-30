import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import { getNationalPhoneNumber, getPhoneCountry } from '../../../utils/phoneNumbers.js'
import {
  emptyUser,
  isScopedRole,
  userRoleDescriptions,
  userRoleOptions,
} from '../data/users.js'
import { createUserSchema } from '../schemas/userSchema.js'
import { communityLabel } from '../utils/communityLabel.js'

function getUserFormValues(user) {
  if (!user) return { ...emptyUser, phoneCountry: 'US' }

  const phoneCountry = getPhoneCountry(user.phone)
  return {
    ...user,
    phoneCountry,
    phone: getNationalPhoneNumber(user.phone, phoneCountry),
  }
}

// Summary tile shown above the table. `color` is a theme palette key, so the
// tinted badge follows light and dark mode without hardcoded values.

export default function UserDialog({ communities, saving, user, users, onClose, onSave }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createUserSchema(users, user?.id ?? null)),
    defaultValues: getUserFormValues(user),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

  // The scope selector only applies to roles that can be limited to specific
  // communities, and the project picker only when they actually are.
  const selectedRole = useWatch({ control, name: 'role' })
  const allProjects = useWatch({ control, name: 'allProjects' })
  const showScopeSelector = isScopedRole(selectedRole)
  const showProjectPicker = showScopeSelector && !allProjects

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {user ? 'Edit user' : 'New user'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {user
            ? 'Update the contact information and access level.'
            : 'Send an invitation so the user can choose their password.'}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.25}>
          <TextField
            label="Name"
            {...register('name')}
            error={Boolean(errors.name)}
            helperText={errors.name?.message ?? ' '}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />

          <TextField
            label="Email"
            type="email"
            {...register('email')}
            error={Boolean(errors.email)}
            helperText={errors.email?.message ?? 'Used to sign in.'}
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MailOutlineRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: { maxLength: 160 },
            }}
          />

          <FormPhoneInput
            control={control}
            name="phone"
            label="Phone number"
            error={errors.phone}
            helperText="Optional · choose +1 or +52"
          />

          <Controller
            name="role"
            control={control}
            render={({ field }) => (
              <FormControl error={Boolean(errors.role)} fullWidth>
                <InputLabel id="user-role-label">Role</InputLabel>
                <Select
                  labelId="user-role-label"
                  label="Role"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                >
                  {userRoleOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  {errors.role?.message ?? userRoleDescriptions[field.value]}
                </FormHelperText>
              </FormControl>
            )}
          />

          {showScopeSelector && (
            <Controller
              name="allProjects"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth>
                  <InputLabel id="user-scope-label">Project access</InputLabel>
                  <Select
                    labelId="user-scope-label"
                    label="Project access"
                    value={field.value ? 'all' : 'selected'}
                    onChange={(event) =>
                      field.onChange(event.target.value === 'all')
                    }
                    onBlur={field.onBlur}
                  >
                    <MenuItem value="all">All projects</MenuItem>
                    <MenuItem value="selected">Selected projects</MenuItem>
                  </Select>
                </FormControl>
              )}
            />
          )}

          {showProjectPicker && (
            <Controller
              name="projectAccess"
              control={control}
              render={({ field }) => (
                <Autocomplete
                  multiple
                  disableCloseOnSelect
                  options={communities.map((community) => community.id)}
                  getOptionLabel={(communityId) => {
                    const community = communities.find(({ id }) => id === communityId)
                    return community ? communityLabel(community) : String(communityId)
                  }}
                  value={field.value}
                  onChange={(_, nextValue) => field.onChange(nextValue)}
                  onBlur={field.onBlur}
                  size="small"
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Projects"
                      placeholder="Add project"
                      error={Boolean(errors.projectAccess)}
                      helperText={
                        errors.projectAccess?.message ??
                        'The user only sees the projects listed here.'
                      }
                    />
                  )}
                />
              )}
            />
          )}

          {user && (
            <Controller
              name="isActive"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth>
                  <InputLabel id="user-status-label">Status</InputLabel>
                  <Select
                    labelId="user-status-label"
                    label="Status"
                    value={field.value ? 'active' : 'inactive'}
                    onChange={(event) =>
                      field.onChange(event.target.value === 'active')
                    }
                    onBlur={field.onBlur}
                  >
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="inactive">Inactive</MenuItem>
                  </Select>
                  <FormHelperText>
                    {field.value
                      ? 'The user can sign in.'
                      : 'The user keeps their history but cannot sign in.'}
                  </FormHelperText>
                </FormControl>
              )}
            />
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={saving} disableElevation>
          {saving ? 'Saving…' : user ? 'Save changes' : 'Send invitation'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
