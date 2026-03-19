/**
 * Fires NEW_ACCOUNTS_AVAILABLE using a real Link-created access token from the DB.
 * Run: npx dotenv -e .env.local -- tsx scripts/fire-webhook.ts
 */
import { Configuration, PlaidApi, PlaidEnvironments, SandboxItemFireWebhookRequestWebhookCodeEnum } from 'plaid'
import { neon } from '@neondatabase/serverless'
import { decrypt } from '../src/lib/crypto'

const WEBHOOK_URL = 'https://coffer.randall.codes/api/plaid/webhook'

const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SANDBOX_SECRET,
      },
    },
  }),
)

;(async () => {
  const sql = neon(process.env.DATABASE_URL!)
  const rows = await sql`
    SELECT id, plaid_item_id, access_token_encrypted
    FROM import_connections
    WHERE access_token_encrypted IS NOT NULL
    LIMIT 10
  `

  if (rows.length === 0) {
    console.error('No import connections in DB. Link a sandbox account through the app first.')
    process.exit(1)
  }

  console.log(`Found ${rows.length} import connection(s)`)

  for (const row of rows) {
    const token = decrypt(row.access_token_encrypted as string)
    const isSandbox = token.startsWith('access-sandbox-')
    console.log(`\nitem ${row.plaid_item_id} sandbox=${isSandbox} token=${token.slice(0, 35)}…`)
    if (!isSandbox) { console.log('  skipping (not a sandbox token)'); continue }

    try {
      await plaid.itemWebhookUpdate({ access_token: token, webhook: WEBHOOK_URL })
    } catch { /* ignore */ }

    try {
      const r = await plaid.sandboxItemFireWebhook({
        access_token: token,
        webhook_code: SandboxItemFireWebhookRequestWebhookCodeEnum.NewAccountsAvailable,
      })
      console.log('✓ NEW_ACCOUNTS_AVAILABLE fired! webhook_fired:', r.data.webhook_fired)
      process.exit(0)
    } catch (e) {
      const d = (e as { response?: { data?: { error_code?: string; error_message?: string } } })?.response?.data
      console.log(`  ✗ ${d?.error_code}: ${d?.error_message}`)
    }
  }

  console.error('\nAll tokens failed. Link a sandbox account through the app at https://coffer.randall.codes first.')
})()
