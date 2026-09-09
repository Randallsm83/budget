import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { verifyPlaidWebhook } from '../plaid-webhook-verify'

type EcJwk = { kty: string; crv: string; x: string; y: string }

// Holds the public JWK the mocked Plaid client hands back. Populated in
// beforeAll; vi.hoisted keeps it reachable from the hoisted mock factory.
const keyHolder = vi.hoisted(() => ({ jwk: undefined as EcJwk | undefined }))

vi.mock('@/lib/plaid', () => ({
  plaidClient: {
    webhookVerificationKeyGet: vi.fn(async ({ key_id }: { key_id: string }) => {
      if (key_id === 'unknown-kid') throw new Error('key not found')
      return { data: { key: keyHolder.jwk } }
    }),
  },
}))

let privateKey: KeyObject
let otherPrivateKey: KeyObject

beforeAll(() => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  privateKey = pair.privateKey
  keyHolder.jwk = pair.publicKey.export({ format: 'jwk' }) as unknown as EcJwk
  otherPrivateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
})

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url')

function makeJwt(
  body: string,
  {
    key,
    alg = 'ES256',
    kid = 'test-kid',
    iat = Math.floor(Date.now() / 1000),
    bodyHash,
  }: { key?: KeyObject; alg?: string; kid?: string; iat?: number; bodyHash?: string } = {},
): string {
  const header = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      iat,
      request_body_sha256: bodyHash ?? createHash('sha256').update(body, 'utf8').digest('hex'),
    }),
  )
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`, 'utf8'), {
    key: key ?? privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `${header}.${payload}.${b64url(signature)}`
}

const BODY = JSON.stringify({ webhook_type: 'TRANSACTIONS', item_id: 'item-1' })

describe('verifyPlaidWebhook', () => {
  it('accepts a correctly signed webhook', async () => {
    expect(await verifyPlaidWebhook(BODY, makeJwt(BODY))).toEqual({ ok: true })
  })

  it('rejects a body altered after signing', async () => {
    const jwt = makeJwt(BODY)
    const tampered = JSON.stringify({ webhook_type: 'TRANSACTIONS', item_id: 'attacker-item' })
    expect(await verifyPlaidWebhook(tampered, jwt)).toEqual({
      ok: false,
      reason: 'body hash mismatch',
    })
  })

  it('rejects a signature made with a different key', async () => {
    const forged = makeJwt(BODY, { key: otherPrivateKey })
    expect(await verifyPlaidWebhook(BODY, forged)).toEqual({ ok: false, reason: 'bad signature' })
  })

  // alg confusion: the token must never be allowed to choose its own algorithm.
  it.each(['none', 'HS256', 'ES384'])('rejects alg=%s', async (alg) => {
    const result = await verifyPlaidWebhook(BODY, makeJwt(BODY, { alg }))
    expect(result).toEqual({ ok: false, reason: `unexpected alg: ${alg}` })
  })

  it('rejects a replayed webhook older than the freshness window', async () => {
    const stale = makeJwt(BODY, { iat: Math.floor(Date.now() / 1000) - 6 * 60 })
    expect(await verifyPlaidWebhook(BODY, stale)).toEqual({ ok: false, reason: 'stale webhook' })
  })

  it('rejects a request with no Plaid-Verification header', async () => {
    expect(await verifyPlaidWebhook(BODY, null)).toEqual({
      ok: false,
      reason: 'missing Plaid-Verification header',
    })
  })

  it('rejects when the signing key cannot be fetched', async () => {
    const jwt = makeJwt(BODY, { kid: 'unknown-kid' })
    expect(await verifyPlaidWebhook(BODY, jwt)).toEqual({
      ok: false,
      reason: 'verification key unavailable',
    })
  })

  it('rejects a JWT that is not three segments', async () => {
    expect(await verifyPlaidWebhook(BODY, 'not.ajwt')).toEqual({ ok: false, reason: 'malformed JWT' })
  })
})
