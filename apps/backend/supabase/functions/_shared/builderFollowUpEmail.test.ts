import { assertEquals, assertMatch } from '@std/assert'
import {
  type BuilderFollowUpEscalationSnapshot,
  type BuilderFollowUpEmailSnapshot,
  type BuilderFollowUpResponseEmailSnapshot,
  renderBuilderFollowUpEscalationEmail,
  renderBuilderFollowUpEmail,
  renderBuilderFollowUpResponseEmail,
  sendBuilderFollowUpEscalationWithResend,
  sendBuilderFollowUpWithResend,
  sendBuilderFollowUpResponseWithResend,
} from './builderFollowUpEmail.ts'

const snapshot: BuilderFollowUpEmailSnapshot = {
  alreadySent: false,
  outboxId: '901',
  idempotencyKey: 'valtrim-follow-up-301-2026-10-15',
  checkpointId: '301',
  scheduleId: '101',
  checkpointCode: 'FOUR_WEEKS',
  daysBefore: 28,
  dueOn: '2026-09-17',
  workDate: '2026-10-15',
  stageType: 'EXT',
  variant: 'BASE',
  jobCode: 'JOB-01',
  community: 'River Walk',
  builderName: 'Acme Builder',
  phaseCode: '2',
  building: 'B',
  lotStartLabel: '1',
  lotEndLabel: '4',
  recipientContactId: '88',
  recipientName: 'Jamie <Superintendent>',
  recipientEmail: 'jamie@example.com',
}

const responseLinks = {
  confirmed: 'https://billing.valtrim.com/follow-up/respond?token=signed&intent=confirmed',
  notReady: 'https://billing.valtrim.com/follow-up/respond?token=signed&intent=not-ready',
}

const escalationSnapshot: BuilderFollowUpEscalationSnapshot = {
  alreadySent: false,
  escalationId: '501',
  idempotencyKey: 'valtrim-no-response-401',
  noResponseEventId: '401',
  scheduleId: '101',
  noResponseSince: '2026-09-18T15:30:00Z',
  waitBusinessDays: 2,
  dueOn: '2026-09-22',
  workDate: '2026-10-15',
  stageType: 'EXT',
  variant: 'BASE',
  jobCode: 'JOB-01',
  community: 'River Walk',
  builderName: 'Acme Builder',
  phaseCode: '2',
  building: 'B',
  lotStartLabel: '1',
  lotEndLabel: '4',
  superintendentContactId: '88',
  superintendentName: 'Jamie Superintendent',
  superintendentEmail: 'jamie@example.com',
  recipientEmails: ['andres@valtrim.com', 'scheduling@valtrim.com'],
}

const responseSnapshot: BuilderFollowUpResponseEmailSnapshot = {
  alreadySent: false,
  notificationId: '801',
  notificationType: 'JOBSITE_RECEIPT',
  idempotencyKey: 'valtrim-follow-up-response-601-jobsite',
  recipientEmails: ['jamie@example.com'],
  responseTokenId: '601',
  scheduleId: '101',
  responseAction: 'NOT_READY',
  respondedAt: '2026-09-21T12:00:00Z',
  targetWorkDate: '2026-10-15',
  finalWorkDate: '2026-10-22',
  stageType: 'EXT',
  variant: 'BASE',
  jobCode: 'JOB-01',
  community: 'River Walk',
  builderName: 'Acme Builder',
  phaseCode: '2',
  building: 'B',
  lotStartLabel: '1',
  lotEndLabel: '4',
  superintendentName: 'Jamie <Superintendent>',
  superintendentEmail: 'jamie@example.com',
  reason: 'Material delivery delayed',
}

Deno.test('renders a deterministic Builder follow-up without treating it as confirmation', () => {
  const rendered = renderBuilderFollowUpEmail(snapshot, responseLinks)

  assertEquals(
    rendered.subject,
    'Action requested: confirm Exterior Frames for JOB-01 on 2026-10-15',
  )
  assertMatch(rendered.text, /confirm Exterior Frames work/u)
  assertMatch(rendered.text, /Thursday, October 15, 2026/u)
  assertMatch(rendered.text, /immediately updates the official Production date/u)
  assertMatch(rendered.html, /Jamie &lt;Superintendent&gt;/u)
  assertMatch(rendered.html, />Confirmed<\/a>/u)
  assertMatch(rendered.html, /Not ready \/ Choose a new date/u)
  assertMatch(rendered.text, /Opening a link does not record a response/u)
})

Deno.test('sends with the durable checkpoint idempotency key and reply-to address', async () => {
  const requests: Request[] = []
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init))
    return Promise.resolve(Response.json({ id: 'email-provider-id' }))
  }) as typeof fetch

  const rendered = renderBuilderFollowUpEmail(snapshot)
  const providerId = await sendBuilderFollowUpWithResend({
    apiKey: 'test-key',
    from: 'ValTrim Scheduling <scheduling@example.com>',
    replyTo: 'scheduler@example.com',
    snapshot,
    rendered,
  }, fetcher)

  assertEquals(providerId, 'email-provider-id')
  const request = requests[0]
  assertEquals(request.headers.get('Idempotency-Key'), snapshot.idempotencyKey)
  const body = await request.json()
  assertEquals(body.to, ['jamie@example.com'])
  assertEquals(body.reply_to, 'scheduler@example.com')
})

Deno.test('surfaces provider errors without exposing the API key', async () => {
  const fetcher = (() => Promise.resolve(Response.json(
    { message: 'Domain is not verified' },
    { status: 422 },
  ))) as typeof fetch

  const rendered = renderBuilderFollowUpEmail(snapshot)
  await new Promise<void>((resolve, reject) => {
    sendBuilderFollowUpWithResend({
      apiKey: 'must-not-appear',
      from: 'ValTrim <scheduling@example.com>',
      replyTo: 'scheduler@example.com',
      snapshot,
      rendered,
    }, fetcher).then(
      () => reject(new Error('Expected the provider request to fail.')),
      (error) => {
        assertMatch(error.message, /Domain is not verified/u)
        assertEquals(error.message.includes('must-not-appear'), false)
        resolve()
      },
    )
  })
})

Deno.test('renders an internal no-response escalation without changing the schedule', () => {
  const rendered = renderBuilderFollowUpEscalationEmail(escalationSnapshot)

  assertEquals(rendered.subject, 'Needs attention: no response for Exterior Frames • JOB-01')
  assertMatch(rendered.text, /after 2 business days/u)
  assertMatch(rendered.text, /andres@valtrim.com, scheduling@valtrim.com/u)
  assertMatch(rendered.text, /does not change the Production date/u)
})

Deno.test('sends an escalation once to all configured internal recipients', async () => {
  const requests: Request[] = []
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init))
    return Promise.resolve(Response.json({ id: 'internal-provider-id' }))
  }) as typeof fetch

  const providerId = await sendBuilderFollowUpEscalationWithResend({
    apiKey: 'test-key',
    from: 'ValTrim Scheduling <scheduling@example.com>',
    replyTo: 'scheduler@example.com',
    snapshot: escalationSnapshot,
    rendered: renderBuilderFollowUpEscalationEmail(escalationSnapshot),
  }, fetcher)

  assertEquals(providerId, 'internal-provider-id')
  assertEquals(requests[0].headers.get('Idempotency-Key'), 'valtrim-no-response-401')
  const body = await requests[0].json()
  assertEquals(body.to, ['andres@valtrim.com', 'scheduling@valtrim.com'])
})

Deno.test('renders Jobsite acknowledgement and internal date-change notices', () => {
  const receipt = renderBuilderFollowUpResponseEmail(responseSnapshot)
  assertEquals(receipt.subject, 'Updated: Exterior Frames for JOB-01 moved to 2026-10-22')
  assertMatch(
    receipt.text,
    /from Thursday, October 15, 2026 to Thursday, October 22, 2026/u,
  )
  assertMatch(receipt.html, /Jamie &lt;Superintendent&gt;/u)

  const internal = renderBuilderFollowUpResponseEmail({
    ...responseSnapshot,
    notificationId: '802',
    notificationType: 'INTERNAL_ALERT',
    idempotencyKey: 'valtrim-follow-up-response-601-internal',
    recipientEmails: ['andres@valtrim.com'],
  })
  assertEquals(internal.subject, 'Schedule changed by Jobsite: Exterior Frames • JOB-01')
  assertMatch(internal.text, /no approval is required/u)
})

Deno.test('uses customer-facing stage names while preserving internal stage codes', () => {
  const doorsAndMoldings = renderBuilderFollowUpEmail({
    ...snapshot,
    stageType: 'DM',
  }, responseLinks)
  assertEquals(
    doorsAndMoldings.subject,
    'Action requested: confirm Doors and Moldings for JOB-01 on 2026-10-15',
  )
  assertMatch(doorsAndMoldings.text, /confirm Doors and Moldings work/u)

  const hardware = renderBuilderFollowUpResponseEmail({
    ...responseSnapshot,
    stageType: 'HW',
    responseAction: 'CONFIRMED',
  })
  assertEquals(
    hardware.subject,
    'Confirmed: Hardware for JOB-01 on 2026-10-22',
  )
  assertMatch(hardware.text, /Hardware work/u)
})

Deno.test('sends a response notice with its durable recipients and idempotency key', async () => {
  const requests: Request[] = []
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init))
    return Promise.resolve(Response.json({ id: 'response-provider-id' }))
  }) as typeof fetch

  const providerId = await sendBuilderFollowUpResponseWithResend({
    apiKey: 'test-key',
    from: 'ValTrim Scheduling <scheduling@example.com>',
    replyTo: 'scheduler@example.com',
    snapshot: responseSnapshot,
    rendered: renderBuilderFollowUpResponseEmail(responseSnapshot),
  }, fetcher)

  assertEquals(providerId, 'response-provider-id')
  assertEquals(
    requests[0].headers.get('Idempotency-Key'),
    'valtrim-follow-up-response-601-jobsite',
  )
  const body = await requests[0].json()
  assertEquals(body.to, ['jamie@example.com'])
})
