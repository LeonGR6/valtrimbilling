import NewRequestPrototypeDialog from './NewRequestPrototypeDialog.jsx'

export default function RequestViewDialog({
  request,
  requests,
  currentUserName,
  onClose,
  onMarkReady,
  onEdit,
  onViewSource,
  onOpenProposal,
}) {
  return (
    <NewRequestPrototypeDialog
      requests={requests}
      request={request}
      currentUserName={currentUserName}
      onClose={onClose}
      onMarkReady={onMarkReady}
      onEdit={onEdit}
      onViewSource={onViewSource}
      onOpenProposal={onOpenProposal}
      readOnly
    />
  )
}
