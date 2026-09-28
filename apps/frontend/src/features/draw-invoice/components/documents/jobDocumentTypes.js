import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import ShoppingCartCheckoutRoundedIcon from '@mui/icons-material/ShoppingCartCheckoutRounded'
import TodayRoundedIcon from '@mui/icons-material/TodayRounded'

export const DOCUMENT_TYPES = [
  {
    key: 'release',
    documentType: 'RELEASE',
    singularLabel: 'Release',
    pluralLabel: 'Releases',
    addLabel: 'Add releases',
    emptyLabel: 'No releases added yet.',
    helperText: 'Signed release documents for this Job.',
    Icon: DescriptionRoundedIcon,
    color: 'primary',
  },
  {
    key: 'purchase-order',
    documentType: 'PURCHASE_ORDER',
    singularLabel: 'Purchase Order',
    pluralLabel: 'Purchase Orders',
    addLabel: 'Add purchase orders',
    emptyLabel: 'No purchase orders added yet.',
    helperText: 'Customer or builder purchase order documents.',
    Icon: ShoppingCartCheckoutRoundedIcon,
    color: 'warning',
  },
  {
    key: 'payment-schedule',
    documentType: 'PAYMENT_SCHEDULE',
    singularLabel: 'Payment Schedule',
    pluralLabel: 'Payment Schedules',
    addLabel: 'Add payment schedules',
    emptyLabel: 'No payment schedules added yet.',
    helperText: 'Payment schedule, Pricing Matrix, PO Matrix documents.',
    Icon: TodayRoundedIcon,
    color: 'info',
  },
  {
    key: 'backup',
    documentType: 'BACKUP',
    singularLabel: 'Backup Document',
    pluralLabel: 'Backup Documentation',
    addLabel: 'Add backup documents',
    emptyLabel: 'No backup documents added yet.',
    helperText: 'Supporting documentation required by the Builder.',
    Icon: Inventory2RoundedIcon,
    color: 'secondary',
  },
]

export function formatFileSize(size) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
