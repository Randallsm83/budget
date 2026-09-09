import { describe, it, expect, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import type { JWK } from 'jose'
import { createHash } from 'node:crypto'
import { verifyPlaidWebhook } from '../plaid-webhook-verify'

const keyHolder = vi.hoisted(() => ({ jwk: undefined as JWK | undefined }))

vi.mock('@/lib/plaid', () => ({
  plaidClient: {
    webhookVerificationKeyGet: vi.fn(async () => ({ data: { key: keyHolder.jwk } })),
  },
}))

// Why this file exists, separately from plaid-webhook-verify.test.ts:
//
// That suite signs its fixtures with the same `dsaEncoding` the verifier reads
// with, so it stays fully green even when BOTH are wrong together - which is
// precisely the mistake that breaks production. Node's crypto.verify defaults to
// DER, while JOSE mandates raw r||s (IEEE P1363). Getting that wrong yields a
// verifier that rejects every real Plaid webhook while its own tests pass.
//
// Verifying a token minted by an independent JOSE implementation is the only
// check that fails in that scenario. Confirmed by mutation: flipping both the
// verifier and the hand-rolled signer to DER leaves that suite at 10/10 passing
// and fails only this test.
describe('JOSE interop', () => {
  it('accepts a JWT signed by an independent JOSE implementation', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
    keyHolder.jwk = await exportJWK(publicKey)

    const body = JSON.stringify({ webhook_type: 'TRANSACTIONS', item_id: 'item-1' })
    const jwt = await new SignJWT({
      request_body_sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'jose-kid' })
      .setIssuedAt()
      .sign(privateKey)

    // Pin the wire format itself, so this fails even without a working verifier:
    // ES256 in JOSE is a bare 64-byte r||s pair, whereas DER runs ~70 bytes.
    //
    // Length alone is the whole check. Asserting the first byte is not DER's 0x30
    // SEQUENCE tag would be flaky: r is uniform, so a valid signature starts with
    // 0x30 about 1 run in 256 (measured 12/3000 = 0.40%). A 64-byte DER encoding
    // would need both r and s to be ~29 bytes, which is astronomically unlikely.
    const signature = Buffer.from(jwt.split('.')[2], 'base64url')
    expect(signature.length).toBe(64)

    expect(await verifyPlaidWebhook(body, jwt)).toEqual({ ok: true })
  })
})
