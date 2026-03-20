/**
 * Integration test for the user-offboarding /item/remove flow.
 *
 * Uses Plaid sandbox to:
 *   1. Create a sandbox Item via /sandbox/public_token/create
 *   2. Exchange it for an access token
 *   3. Call /item/remove (our removeItem utility)
 *   4. Verify the item is no longer accessible (expects ITEM_NOT_FOUND)
 *
 * Run with:
 *   npm run test:offboarding
 *
 * Requires: PLAID_CLIENT_ID + PLAID_SANDBOX_SECRET in .env.local
 * Note: /sandbox/public_token/create is intentionally only used in this test
 * script — the app itself makes no /sandbox/ endpoint calls.
 */

import 'dotenv/config'
import { Configuration, PlaidApi, PlaidEnvironments, Products } from 'plaid'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// ---------------------------------------------------------------------------
// Inline crypto helpers (mirrors src/lib/crypto.ts to avoid Next.js imports)
// ---------------------------------------------------------------------------
const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY?.trim()
  if (!hex || hex.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
  return Buffer.from(hex, 'hex')
}

function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

function decrypt(ciphertext: string): string {
  const key = getKey()
  const [ivHex, tagHex, encHex] = ciphertext.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const enc = Buffer.from(encHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(enc).toString('utf8') + decipher.final('utf8')
}

// ---------------------------------------------------------------------------
// Sandbox Plaid client
// ---------------------------------------------------------------------------
const clientId = process.env.PLAID_CLIENT_ID?.trim()
const secret = process.env.PLAID_SANDBOX_SECRET?.trim()

if (!clientId || !secret) {
  console.error('❌  PLAID_CLIENT_ID and PLAID_SANDBOX_SECRET must be set in .env.local')
  process.exit(1)
}

const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  }),
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ok(msg: string) { console.log(`   ✅  ${msg}`) }
function fail(msg: string) { console.error(`   ❌  ${msg}`); process.exit(1) }

async function removeItem(accessTokenEncrypted: string): Promise<void> {
  try {
    const accessToken = decrypt(accessTokenEncrypted)
    await plaid.itemRemove({ access_token: accessToken })
  } catch (err) {
    console.warn('   ⚠️  itemRemove failed (may already be removed):', (err as Error).message)
  }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------
async function run() {
  console.log('\n─── Plaid /item/remove offboarding test ───\n')

  // 1. Create a sandbox Item
  console.log('1. Creating sandbox public token (ins_109508 — Chase)...')
  const ptRes = await plaid.sandboxPublicTokenCreate({
    institution_id: 'ins_109508',
    initial_products: [Products.Transactions],
    options: { override_username: 'user_good', override_password: 'pass_good' },
  })
  const publicToken = ptRes.data.public_token
  ok(`public_token: ${publicToken.slice(0, 24)}…`)

  // 2. Exchange for access token
  console.log('2. Exchanging for access token...')
  const exRes = await plaid.itemPublicTokenExchange({ public_token: publicToken })
  const accessToken = exRes.data.access_token
  const itemId = exRes.data.item_id
  ok(`item_id: ${itemId}`)

  // 3. Simulate how the app stores it — encrypted
  console.log('3. Encrypting access token (as the app would before DB storage)...')
  const encrypted = encrypt(accessToken)
  ok(`encrypted length: ${encrypted.length} chars`)

  const roundTripped = decrypt(encrypted)
  if (roundTripped !== accessToken) fail('encrypt/decrypt round-trip mismatch')
  ok('encrypt → decrypt round-trip verified')

  // 4. Verify the item is accessible before removal
  console.log('4. Verifying item is accessible...')
  const itemRes = await plaid.itemGet({ access_token: accessToken })
  if (itemRes.data.item.item_id !== itemId) fail('item_id mismatch')
  ok(`item accessible (institution: ${itemRes.data.item.institution_id})`)

  // 5. Call /item/remove (via our removeItem utility)
  console.log('5. Calling /item/remove via removeItem()...')
  await removeItem(encrypted)
  ok('removeItem() completed without error')

  // 6. Verify item is gone
  console.log('6. Verifying item is no longer accessible (expect ITEM_NOT_FOUND)...')
  try {
    await plaid.itemGet({ access_token: accessToken })
    fail('item still accessible after /item/remove — removal did not work')
  } catch (err) {
    const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code
    if (code === 'ITEM_NOT_FOUND' || code === 'INVALID_ACCESS_TOKEN') {
      ok(`item no longer accessible (Plaid returned ${code})`)
    } else {
      fail(`unexpected error after removal: ${JSON.stringify((err as { response?: { data?: unknown } })?.response?.data ?? err)}`)
    }
  }

  // 7. Verify removeItem is idempotent (second call should not throw)
  console.log('7. Verifying removeItem() is idempotent (calling again on removed item)...')
  await removeItem(encrypted)
  ok('second removeItem() call swallowed gracefully')

  console.log('\n✅  All checks passed — /item/remove offboarding flow is working correctly\n')
}

run().catch((err) => {
  console.error('\n❌  Test failed:', (err as { response?: { data?: unknown } })?.response?.data ?? err)
  process.exit(1)
})
