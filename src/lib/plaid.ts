import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

const rawEnv = (process.env.PLAID_ENV ?? 'sandbox').trim()
const env: keyof typeof PlaidEnvironments =
  rawEnv in PlaidEnvironments ? (rawEnv as keyof typeof PlaidEnvironments) : 'production'

// Use the environment-specific secret when available
const secret =
  env === 'sandbox'
    ? (process.env.PLAID_SANDBOX_SECRET ?? process.env.PLAID_SECRET)
    : process.env.PLAID_SECRET

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
