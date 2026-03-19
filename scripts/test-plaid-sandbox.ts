/**
 * Plaid Quickstart sandbox verification script.
 * Run with: npx dotenv -e .env.local -- tsx scripts/test-plaid-sandbox.ts
 *
 * Completes two Plaid dashboard tasks:
 *   1. "Test Enrich endpoint"  — calls /transactions/enrich with preset sandbox descriptions
 *   2. "Setup webhooks"        — fires NEW_ACCOUNTS_AVAILABLE (falls back to SYNC_UPDATES_AVAILABLE)
 */
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  EnrichTransactionDirection,
  WebhookType,
  SandboxItemFireWebhookRequestWebhookCodeEnum,
} from 'plaid'

const CLIENT_ID = process.env.PLAID_CLIENT_ID
const SANDBOX_SECRET = process.env.PLAID_SANDBOX_SECRET
const WEBHOOK_URL = process.env.PLAID_WEBHOOK_URL ?? 'https://coffer.randall.codes/api/plaid/webhook'

if (!CLIENT_ID || !SANDBOX_SECRET) {
  console.error('Missing PLAID_CLIENT_ID or PLAID_SANDBOX_SECRET in environment')
  process.exit(1)
}

const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': CLIENT_ID,
        'PLAID-SECRET': SANDBOX_SECRET,
        'Plaid-Version': '2020-09-14',
      },
    },
  }),
)

// ─── helpers ──────────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  return JSON.stringify(data ?? (err instanceof Error ? err.message : err), null, 2)
}

// ─── 1. Enrich ────────────────────────────────────────────────────────────────

// Sandbox preset description confirmed to work (Plaid's sandbox is occasionally
// flaky for this endpoint; we retry a few times).
const PRESET_DESC = 'DD DOORDASH BURGERKIN ************ CA'

async function testEnrich() {
  console.log('\n━━━  /transactions/enrich  ━━━')

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await plaid.transactionsEnrich({
        account_type: 'depository',
        transactions: [
          {
            id: `txn-${attempt}`,
            description: PRESET_DESC,
            amount: 28.34,
            iso_currency_code: 'USD',
            direction: EnrichTransactionDirection.Outflow,
          },
        ],
      })
      const [t] = res.data.enriched_transactions
      console.log(
        `✓  Enrich succeeded (attempt ${attempt}) — merchant="${t?.enrichments?.merchant_name ?? 'n/a'}"` +
          `  category=${t?.enrichments?.personal_finance_category?.primary ?? 'n/a'}`,
      )
      return
    } catch {
      console.log(`  attempt ${attempt} failed, retrying...`)
      await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
  console.error('✗  All 5 enrich attempts failed')
}

// ─── 2. Webhook ───────────────────────────────────────────────────────────────

async function testWebhook() {
  console.log('\n━━━  /sandbox/item/fire_webhook  ━━━')

  // Step 1 — create a fresh sandbox item with the webhook URL baked in
  let accessToken: string
  try {
    const pt = await plaid.sandboxPublicTokenCreate({
      institution_id: 'ins_109508',
      initial_products: [Products.Transactions],
      options: { webhook: WEBHOOK_URL } as { webhook: string },
    })
    console.log('✓  Sandbox public token created')

    const ex = await plaid.itemPublicTokenExchange({ public_token: pt.data.public_token })
    accessToken = ex.data.access_token
    console.log('✓  Access token obtained:', accessToken.slice(0, 38) + '…')
  } catch (err) {
    console.error('✗  Could not obtain sandbox access token:\n', errMsg(err))
    return
  }

  // Step 2 — confirm webhook URL via item/webhook/update
  try {
    await plaid.itemWebhookUpdate({ access_token: accessToken, webhook: WEBHOOK_URL })
    console.log('✓  Webhook URL confirmed:', WEBHOOK_URL)
  } catch (err) {
    // Non-fatal — the webhook URL was already set during token create
    console.log('  (webhook/update skipped):', errMsg(err))
  }

  // Step 3 — fire ITEM / NEW_ACCOUNTS_AVAILABLE (requires Account Select v2)
  console.log('\n  Firing ITEM / NEW_ACCOUNTS_AVAILABLE…')
  try {
    const res = await plaid.sandboxItemFireWebhook({
      access_token: accessToken,
      webhook_type: WebhookType.Item,
      webhook_code: SandboxItemFireWebhookRequestWebhookCodeEnum.NewAccountsAvailable,
    })
    console.log('✓  NEW_ACCOUNTS_AVAILABLE fired:', res.data)
    return
  } catch (err) {
    const d = (err as { response?: { data?: { error_code?: string } } })?.response?.data
    console.log(`  ✗ NEW_ACCOUNTS_AVAILABLE failed (${d?.error_code ?? 'UNKNOWN'}):`, JSON.stringify(d))

    if (d?.error_code === 'SANDBOX_ACCOUNT_SELECT_V2_NOT_ENABLED') {
      console.log(
        '\n  ⚠  Account Select v2 is not enabled for this Plaid application.\n' +
          '     To fix: Plaid dashboard → Team Settings → Account select → switch to v2.\n' +
          '     Falling back to TRANSACTIONS / SYNC_UPDATES_AVAILABLE for now…',
      )
    }
  }

  // Step 3b — fallback: TRANSACTIONS / SYNC_UPDATES_AVAILABLE
  console.log('\n  Firing TRANSACTIONS / SYNC_UPDATES_AVAILABLE…')
  try {
    const res = await plaid.sandboxItemFireWebhook({
      access_token: accessToken,
      webhook_type: WebhookType.Transactions,
      webhook_code: SandboxItemFireWebhookRequestWebhookCodeEnum.SyncUpdatesAvailable,
    })
    console.log('✓  SYNC_UPDATES_AVAILABLE fired:', res.data)
  } catch (err) {
    console.error('✗  SYNC_UPDATES_AVAILABLE also failed:\n', errMsg(err))
  }
}

// ─── main ─────────────────────────────────────────────────="────────────────

;(async () => {
  console.log(`Plaid Sandbox Test\nClient ID : ${CLIENT_ID}\nBase URL  : ${PlaidEnvironments.sandbox}\nWebhook   : ${WEBHOOK_URL}`)
  await testEnrich()
  await testWebhook()
  console.log('\nDone.')
})().catch(console.error)
