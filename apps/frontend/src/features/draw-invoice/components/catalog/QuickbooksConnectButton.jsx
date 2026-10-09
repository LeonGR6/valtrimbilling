import {
  quickbooksButtonTitle,
  quickbooksStatusView,
} from '../../services/quickbooksRecord.js'
import QuickbooksStatusCard from '../shared/QuickbooksStatusCard.jsx'

/** QuickBooks connection card; selecting it (administrators only) starts the connection. */
export default function QuickbooksConnectButton({
  connection,
  loading,
  canConnect,
  onConnect,
}) {
  const view = quickbooksStatusView({ loading, connection, canConnect })

  return (
    <QuickbooksStatusCard
      tone={view.tone}
      status={view.status}
      detail={view.detail}
      title={quickbooksButtonTitle({ canConnect, connection })}
      onClick={canConnect && !loading ? onConnect : undefined}
    />
  )
}
