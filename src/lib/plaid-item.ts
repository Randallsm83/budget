import { plaidClient } from './plaid'
import { decrypt } from './crypto'

/**
 * Calls Plaid's /item/remove for the given encrypted access token.
 * Errors are logged but not rethrown — the Item may have already been removed
 * by the user, the institution, or another app.
 */
export async function removeItem(accessTokenEncrypted: string): Promise<void> {
  try {
    const accessToken = decrypt(accessTokenEncrypted)
    await plaidClient.itemRemove({ access_token: accessToken })
    console.log('[plaid] itemRemove succeeded')
  } catch (err) {
    // ITEM_NOT_FOUND / NO_ACCOUNTS are expected when the Item was already removed
    console.warn('[plaid] itemRemove failed (may already be removed):', err instanceof Error ? err.message : err)
  }
}
