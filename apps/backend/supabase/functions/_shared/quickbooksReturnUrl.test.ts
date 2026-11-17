import { assertEquals } from '@std/assert'
import { resolveReturnUrl } from './quickbooksReturnUrl.ts'

const configured = 'https://valtrim.vercel.app/draw-invoice'

Deno.test('comes back to the page that started the connection, without query or hash', () => {
  assertEquals(
    resolveReturnUrl('https://valtrim.vercel.app/draw-invoice?tab=packages#top', configured, null),
    'https://valtrim.vercel.app/draw-invoice',
  )
})

Deno.test('localhost on any port is allowed, whatever is configured', () => {
  assertEquals(resolveReturnUrl('http://localhost:5173/draw-invoice', configured, null), 'http://localhost:5173/draw-invoice')
  assertEquals(resolveReturnUrl('http://127.0.0.1:3000/x', null, null), 'http://127.0.0.1:3000/x')
  assertEquals(resolveReturnUrl('http://[::1]:5173/x', null, null), 'http://[::1]:5173/x')
})

Deno.test('other origins need to be configured or listed', () => {
  assertEquals(resolveReturnUrl('https://evil.example/draw-invoice', configured, null), null)
  assertEquals(resolveReturnUrl('https://valtrim.vercel.app.evil.example/x', configured, null), null)
  assertEquals(resolveReturnUrl('https://preview.vercel.app/x', configured, 'https://preview.vercel.app, https://b.example'), 'https://preview.vercel.app/x')
  assertEquals(resolveReturnUrl('https://other.vercel.app/x', null, null), null)
})

Deno.test('refuses what is not a plain http(s) page', () => {
  for (const bad of [null, undefined, 42, '', 'not a url', 'javascript:alert(1)', 'https://user:pw@valtrim.vercel.app/x', 'http://valtrim.vercel.app/x']) {
    assertEquals(resolveReturnUrl(bad, configured, null), null)
  }
})
