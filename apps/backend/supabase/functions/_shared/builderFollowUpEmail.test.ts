import { assertEquals, assertMatch } from '@std/assert'
import {
  type BuilderFollowUpEmailSnapshot,
  renderBuilderFollowUpEmail,
  sendBuilderFollowUpWithResend,
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

Deno.test('renders a deterministic Builder follow-up without treating it as confirmation', () => {
  const rendered = renderBuilderFollowUpEmail(snapshot)

  assertEquals(
    rendered.subject,
    'Action requested: confirm EXT for JOB-01 on 2026-10-15',
  )
  assertMatch(rendered.text, /Thursday, October 15, 2026/u)
  assertMatch(rendered.text, /does not change or confirm/u)
  assertMatch(rendered.html, /Jamie &lt;Superintendent&gt;/u)
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
