import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

const env = ((process.env.PLAID_ENV ?? 'sandbox').trim()) as keyof typeof PlaidEnvironments

const config = new Configuration({
  basePath: PlaidEnvironments[env],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID?.trim(),
      'PLAID-SECRET': process.env.PLAID_SECRET?.trim(),
    },
  },
})

export const plaidClient = new PlaidApi(config)
