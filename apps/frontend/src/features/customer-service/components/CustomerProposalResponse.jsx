import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, Container, Paper, Stack, TextField, Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import {
  acceptCustomerProposal, chooseCustomerAlternative, declineCustomerProposal, viewCustomerProposal,
} from '../services/customerProposalResponse.js'

// The customer's page for a proposal (block B, step B5; decided 23 Nov 2026). It opens
// from the buttons of the invitation or the reminder, with no sign-in. Opening it never
// records anything (mail scanners open links on their own): the customer confirms a day,
// picks one of the other days, or says none works, each with a button here. The page
// shows Valtrim, the address, the work and the days: nothing internal.

const longDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
})

function DayCard({ title, date, windowLabel, highlighted, children }) {
  return (
    <Paper variant="outlined" sx={{
      p: 2, borderColor: highlighted ? 'primary.main' : 'divider', borderWidth: highlighted ? 2 : 1,
      bgcolor: highlighted ? 'primary.light' : 'background.paper',
    }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Box>
          {title && <Typography variant="caption" color="primary" fontWeight={700} sx={{ textTransform: 'uppercase' }}>{title}</Typography>}
          <Typography variant="subtitle1" fontWeight={800}>{longDate(date)}</Typography>
          {windowLabel && <Typography variant="body2" color="text.secondary">Arrival window: {windowLabel}</Typography>}
        </Box>
        {children}
      </Stack>
    </Paper>
  )
}

function Answered({ proposal }) {
  const accepted = proposal.options.find((option) => option.accepted)
  const message = {
    ACCEPTED: accepted
      ? `Your service visit is confirmed for ${longDate(accepted.date)}, arrival window ${accepted.windowLabel}. We emailed you a confirmation.`
      : 'Your service visit is confirmed. We emailed you a confirmation.',
    COUNTER_PROPOSED: 'Thank you. We received the day you chose, and Valtrim will confirm it with you shortly.',
    REJECTED: 'Thank you. Valtrim will call you to find another time.',
  }[proposal.status] ?? 'This proposal is no longer available. Valtrim will contact you.'
  return (
    <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', py: 2 }}>
      <CheckCircleRoundedIcon color={proposal.status === 'ACCEPTED' ? 'success' : 'primary'} sx={{ fontSize: 48 }} />
      <Typography variant="h6" fontWeight={800}>{proposal.status === 'ACCEPTED' ? 'You are all set' : 'Thank you'}</Typography>
      <Typography variant="body1">{message}</Typography>
    </Stack>
  )
}

export default function CustomerProposalResponse() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim() ?? ''
  const choice = searchParams.get('choice') ?? ''
  const [proposal, setProposal] = useState(null)
  const [loading, setLoading] = useState(Boolean(token))
  const [error, setError] = useState(token ? '' : 'This link is not valid. Reply to the email instead.')
  const [saving, setSaving] = useState('')
  const [showOthers, setShowOthers] = useState(choice === 'none')
  const [callBack, setCallBack] = useState({ bestTime: '', phone: '' })

  useEffect(() => {
    if (!token) return undefined
    let active = true
    viewCustomerProposal(token)
      .then((loaded) => { if (active) setProposal(loaded) })
      .catch((loadError) => { if (active) setError(loadError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  const answer = async (key, run) => {
    setSaving(key)
    setError('')
    try {
      setProposal(await run())
    } catch (answerError) {
      setError(answerError.message)
      // The days may have changed meanwhile; show them as they are now.
      viewCustomerProposal(token).then(setProposal).catch(() => {})
    } finally {
      setSaving('')
    }
  }

  const waiting = proposal?.status === 'SENT'
  const several = (proposal?.options.length ?? 0) > 1
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, sm: 6 } }}>
      <Container maxWidth="sm">
        <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 4 }}>
          <Box sx={{ bgcolor: 'grey.900', color: 'common.white', textAlign: 'center', py: 3 }}>
            <Typography variant="h6" fontWeight={700} component="div">Valtrim</Typography>
          </Box>
          <Stack spacing={3} sx={{ p: { xs: 3, sm: 5 } }}>
            {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
            {error && <Alert severity={proposal ? 'warning' : 'error'}>{error}</Alert>}

            {proposal && !waiting && <Answered proposal={proposal} />}

            {proposal && waiting && (
              <>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" fontWeight={800}>
                    {several ? 'Choose a day for your service visit' : 'Can we visit on this day?'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {proposal.customerName ? `Hi ${proposal.customerName}, ` : ''}we are holding {several ? 'these times' : 'this time'} for you.
                    Confirm the one that works with its button.
                  </Typography>
                </Box>

                <Stack spacing={1.5}>
                  {proposal.options.map((option) => (
                    <DayCard key={option.number} title={several ? `Option ${option.number}` : ''} date={option.date}
                      windowLabel={option.windowLabel} highlighted={choice === `option-${option.number}`}>
                      {option.started ? (
                        <Typography variant="body2" color="text.secondary">This day has already started.</Typography>
                      ) : (
                        <Button variant="contained" disabled={Boolean(saving)}
                          onClick={() => answer(`option-${option.number}`, () => acceptCustomerProposal(token, option.number))}>
                          {saving === `option-${option.number}` ? 'Confirming…' : 'Confirm this day'}
                        </Button>
                      )}
                    </DayCard>
                  ))}
                </Stack>

                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
                  {[['Address', proposal.address], ['Work', proposal.work], ['Reference', proposal.folio]]
                    .filter(([, value]) => value).map(([label, value]) => (
                      <Stack key={label} direction="row" spacing={2} sx={{ py: 0.25 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ width: 80, flexShrink: 0 }}>{label}</Typography>
                        <Typography variant="body2">{value}</Typography>
                      </Stack>
                    ))}
                </Box>

                {!showOthers ? (
                  <Button variant="outlined" color="inherit" onClick={() => setShowOthers(true)} sx={{ alignSelf: 'center' }}>
                    {several ? 'None of these days work' : 'This day does not work'}
                  </Button>
                ) : (
                  <Stack spacing={1.5}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={800}>Other days that work for us</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {proposal.alternatives.length
                          ? 'Pick one and Valtrim will confirm it with you.'
                          : 'We have no other days to offer right now.'}
                      </Typography>
                    </Box>
                    {proposal.alternatives.map((alternative) => (
                      <DayCard key={alternative.index} date={alternative.date} windowLabel={alternative.windowLabel}>
                        <Button variant="outlined" disabled={Boolean(saving)}
                          onClick={() => answer(`alternative-${alternative.index}`, () => chooseCustomerAlternative(token, alternative.index))}>
                          {saving === `alternative-${alternative.index}` ? 'Sending…' : 'Choose this day'}
                        </Button>
                      </DayCard>
                    ))}
                    {/* "Please call me": when and where to call, both optional. */}
                    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
                      <Typography variant="subtitle2" fontWeight={800}>
                        {proposal.alternatives.length ? 'None of these work?' : 'Prefer a call?'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        Valtrim will call you to find another time.
                      </Typography>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                        <TextField label="Best time to call (optional)" placeholder="Weekdays after 5 PM" size="small" fullWidth
                          value={callBack.bestTime} slotProps={{ htmlInput: { maxLength: 80 } }}
                          onChange={(event) => setCallBack((current) => ({ ...current, bestTime: event.target.value }))} />
                        <TextField label="Phone number (optional)" placeholder="(951) 555-0101" size="small" fullWidth
                          type="tel" value={callBack.phone} slotProps={{ htmlInput: { maxLength: 30 } }}
                          onChange={(event) => setCallBack((current) => ({ ...current, phone: event.target.value }))} />
                      </Stack>
                      <Button variant="outlined" color="inherit" disabled={Boolean(saving)} sx={{ mt: 1.5 }}
                        onClick={() => answer('none', () => declineCustomerProposal(token, callBack))}>
                        {saving === 'none' ? 'Sending…' : 'Please call me'}
                      </Button>
                    </Box>
                  </Stack>
                )}
              </>
            )}
          </Stack>
          <Box sx={{ bgcolor: 'action.hover', borderTop: 1, borderColor: 'divider', textAlign: 'center', p: 2.5 }}>
            <Typography variant="caption" color="text.secondary">
              Valtrim Customer Service{proposal?.folio ? ` · Service request ${proposal.folio}` : ''}. You can also reply to our email.
            </Typography>
          </Box>
        </Paper>
      </Container>
    </Box>
  )
}
