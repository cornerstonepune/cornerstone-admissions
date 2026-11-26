import crypto from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// G2.4 (#65): the REAL signature check sits in front of every write.
// route.test.ts mocks verifyMetaWebhookSignature to `true`; this file
// does not, and records every Supabase call and every after() job.
const h = vi.hoisted(() => ({
  dbCalls: [] as string[],
  afterJobs: 0,
}))

vi.mock('next/server', () => ({
  after: () => {
    h.afterJobs++
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      h.dbCalls.push(`from:${table}`)
      throw new Error('no database access expected')
    },
    rpc: (name: string) => {
      h.dbCalls.push(`rpc:${name}`)
      throw new Error('no database access expected')
    },
  }),
}))

import { POST } from './route'

const SECRET = 'g24-test-secret'
const BODY = JSON.stringify({
  entry: [
    {
      id: 'waba-1',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'pn-1' },
            contacts: [{ wa_id: '15551230000', profile: { name: 'Ada' } }],
            messages: [
              { id: 'wamid.X', from: '15551230000', timestamp: '1700000000', type: 'text', text: { body: 'hi' } },
            ],
          },
        },
      ],
    },
  ],
})

const sign = (body: string, secret: string) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')

function post(signature?: string) {
  return new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: signature ? { 'x-hub-signature-256': signature } : {},
    body: BODY,
  })
}

type Res = { init?: { status?: number } }

describe('webhook POST: signature gate (G2.4)', () => {
  beforeEach(() => {
    vi.stubEnv('META_APP_SECRET', SECRET)
    h.dbCalls = []
    h.afterJobs = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it.each([
    ['no signature header', undefined],
    ['a signature from the wrong secret', sign(BODY, 'not-the-secret')],
    ['a malformed signature', 'sha256=deadbeef'],
    ['a signature without the sha256= prefix', sign(BODY, SECRET).slice(7)],
  ])('answers 401 and writes nothing for %s', async (_label, signature) => {
    const res = (await POST(post(signature))) as unknown as Res
    expect(res.init?.status).toBe(401)
    expect(h.dbCalls).toEqual([])
    expect(h.afterJobs).toBe(0)
  })

  it('answers 401 when META_APP_SECRET is unset, even for a once-valid signature', async () => {
    vi.stubEnv('META_APP_SECRET', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = (await POST(post(sign(BODY, SECRET)))) as unknown as Res
    expect(res.init?.status).toBe(401)
    expect(h.dbCalls).toEqual([])
    expect(h.afterJobs).toBe(0)
  })

  it('lets a correctly signed request past the gate (control)', async () => {
    const res = (await POST(post(sign(BODY, SECRET)))) as unknown as Res
    expect(res.init?.status).not.toBe(401)
    expect(h.afterJobs).toBe(1)
  })
})
