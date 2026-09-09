import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { z } from 'zod'
import { plaidClient } from './plaid'

// Plaid signs every webhook (in Sandbox as well as Production) with an ES256 JWT
// in the `Plaid-Verification` header. The JWT carries a `request_body_sha256`
// claim over the RAW request body, so the body must be hashed exactly as
// received - never re-serialized from a parsed object.
// https://plaid.com/docs/api/webhooks/webhook-verification/

const jwtHeaderSchema = z.object({ alg: z.string(), kid: z.string() })
const jwtPayloadSchema = z.object({ iat: z.number(), request_body_sha256: z.string() })

/**
 * Plaid rotates signing keys and we learn each `kid` at runtime, so this is a
 * genuine dynamic cache rather than a static lookup table.
 */
const keyCache = new Map<string, KeyObject>()

const MAX_AGE_SECONDS = 5 * 60
/** Tolerance for our clock running slightly ahead of Plaid's. */
const MAX_SKEW_SECONDS = 30

export type VerifyResult = { ok: true } | { ok: false; reason: string }

/** Decode one base64url JWT segment and validate its shape. Untrusted input. */
function decodeSegment<T>(part: string, schema: z.ZodType<T>): T | null {
  let json: unknown
  try {
    json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const parsed = schema.safeParse(json)
  return parsed.success ? parsed.data : null
}

async function getVerificationKey(kid: string): Promise<KeyObject | null> {
  const cached = keyCache.get(kid)
  if (cached) return cached

  let key: KeyObject
  try {
    const res = await plaidClient.webhookVerificationKeyGet({ key_id: kid })
    const jwk = res.data.key
    // Pass only the EC members through; Plaid also returns bookkeeping fields
    // (created_at/expired_at) that are not part of a JWK key import.
    key = createPublicKey({
      key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      format: 'jwk',
    })
  } catch {
    return null
  }

  keyCache.set(kid, key)
  return key
}

/**
 * Verify a Plaid webhook's signature over the raw request body.
 *
 * Fails closed: any missing, malformed, or expired input is rejected rather
 * than assumed benign, because callers of this endpoint are unauthenticated.
 */
export async function verifyPlaidWebhook(
  rawBody: string,
  signedJwt: string | null,
): Promise<VerifyResult> {
  if (!signedJwt) return { ok: false, reason: 'missing Plaid-Verification header' }

  const parts = signedJwt.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed JWT' }
  const [encodedHeader, encodedPayload, encodedSignature] = parts

  const header = decodeSegment(encodedHeader, jwtHeaderSchema)
  if (!header) return { ok: false, reason: 'malformed JWT header (need alg + kid)' }
  // Pin the algorithm. Never let the token pick it - that is the alg-confusion
  // attack, where `none` or an HMAC alg turns the public key into a shared secret.
  if (header.alg !== 'ES256') return { ok: false, reason: `unexpected alg: ${header.alg}` }

  const key = await getVerificationKey(header.kid)
  if (!key) return { ok: false, reason: 'verification key unavailable' }

  // JWT ES256 signatures are raw r||s (IEEE P1363), not DER-wrapped.
  const signatureValid = verify(
    'sha256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
    { key, dsaEncoding: 'ieee-p1363' },
    Buffer.from(encodedSignature, 'base64url'),
  )
  if (!signatureValid) return { ok: false, reason: 'bad signature' }

  const payload = decodeSegment(encodedPayload, jwtPayloadSchema)
  if (!payload) {
    return { ok: false, reason: 'malformed JWT payload (need iat + request_body_sha256)' }
  }

  const age = Math.floor(Date.now() / 1000) - payload.iat
  if (age > MAX_AGE_SECONDS) return { ok: false, reason: 'stale webhook' }
  if (age < -MAX_SKEW_SECONDS) return { ok: false, reason: 'future-dated webhook' }

  const actual = Buffer.from(createHash('sha256').update(rawBody, 'utf8').digest('hex'), 'utf8')
  const expected = Buffer.from(payload.request_body_sha256, 'utf8')
  // timingSafeEqual throws on a length mismatch, so length must be checked first.
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: 'body hash mismatch' }
  }

  return { ok: true }
}
