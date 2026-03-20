import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

// NOTE: This app makes NO calls to Plaid /sandbox/ endpoints. All API calls
// use standard product endpoints that work in both sandbox and production.

const rawEnv = (process.env.PLAID_ENV ?? 'sandbox').trim()
const env: keyof typeof PlaidEnvironments =
  rawEnv in PlaidEnvironments ? (rawEnv as keyof typeof PlaidEnvironments) : 'production'

// Use the environment-specific secret when available
const secret =
  env === 'sandbox'
    ? (process.env.PLAID_SANDBOX_SECRET ?? process.env.PLAID_SECRET)
    : process.env.PLAID_SECRET

// ---------------------------------------------------------------------------
// Production environment validation
// Fail loudly at startup rather than returning confusing 400/401 errors later.
// ---------------------------------------------------------------------------
if (env !== 'sandbox') {
  const missing: string[] = []
  if (!process.env.PLAID_CLIENT_ID?.trim()) missing.push('PLAID_CLIENT_ID')
  if (!secret?.trim()) missing.push('PLAID_SECRET')
  if (!process.env.ENCRYPTION_KEY?.trim() || process.env.ENCRYPTION_KEY.trim().length !== 64)
    missing.push('ENCRYPTION_KEY (must be 64 hex chars)')
  if (missing.length > 0) {
    throw new Error(
      `[plaid] Missing required environment variables for ${env} environment: ${missing.join(', ')}`,
    )
  }
}

const config = new Configuration({
  basePath: PlaidEnvironments[env],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID?.trim(),
      'PLAID-SECRET': secret?.trim(),
    },
  },
})

export const plaidClient = new PlaidApi(config)
