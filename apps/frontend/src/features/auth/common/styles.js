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
