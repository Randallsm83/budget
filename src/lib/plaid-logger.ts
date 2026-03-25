/**
 * Structured logging for all Plaid API calls.
 *
 * Every log entry is a single-line JSON object containing the identifiers
 * recommended by Plaid for troubleshooting and support:
 *   - request_id  → required when filing a Plaid support ticket
 *   - item_id     → identifies the Plaid Item (use in Item Debugger)
 *   - account_id  → Plaid-side account identifier
 *   - link_session_id → ties backend events to a specific Link session
 *
 * Vercel / Datadog / Logtail: filter on '[plaid]' to see all Plaid activity.
 * To upgrade to a dedicated log platform, replace the console calls below.
 */

export interface PlaidLogEntry {
  route: string
  /** Our internal DB user ID */
  userId?: string
  /** Our internal DB account ID */
  accountId?: string
  /** Plaid item_id — use with Plaid Dashboard > Item Debugger */
  plaidItemId?: string
  /** Plaid account_id (institution-side) */
  plaidAccountId?: string
  /** Plaid institution_id */
  institutionId?: string
  /** Plaid request_id — required for Plaid support tickets */
  requestId?: string
  /** link_session_id from Plaid Link onEvent/onSuccess */
  linkSessionId?: string
  /** Plaid error fields */
  errorType?: string
  errorCode?: string
  errorMessage?: string
  /** Additional context (counts, statuses, etc.) */
  [key: string]: unknown
}

export function plaidLog(level: 'info' | 'warn' | 'error', entry: PlaidLogEntry) {
  const output = JSON.stringify({ ...entry, ts: new Date().toISOString() })
  if (level === 'error') console.error('[plaid]', output)
  else if (level === 'warn')  console.warn('[plaid]', output)
  else                         console.log('[plaid]', output)

  // Persist errors and warnings to app_logs for long-term debugging
  if (level === 'error' || level === 'warn') {
    // Dynamic import avoids circular deps; fire-and-forget
    import('@/lib/logger').then(({ appLog }) => {
      appLog(level, `plaid/${entry.route}`, entry.errorMessage ?? entry.errorCode ?? 'Plaid error', {
        userId: entry.userId,
        metadata: {
          errorCode:    entry.errorCode,
          errorType:    entry.errorType,
          requestId:    entry.requestId,
          plaidItemId:  entry.plaidItemId,
          plaidAccountId: entry.plaidAccountId,
        },
      })
    }).catch(() => { /* never block */ })
  }
}

/**
 * Extracts structured error fields from a failed Plaid API call.
 * The error_code and request_id are the two most important fields for
 * diagnosing issues and filing support tickets.
 */
export function extractPlaidError(err: unknown): Pick<PlaidLogEntry, 'errorType' | 'errorCode' | 'errorMessage' | 'requestId'> {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data
  if (data && typeof data === 'object') {
    return {
      errorType:    data.error_type    as string | undefined,
      errorCode:    data.error_code    as string | undefined,
      errorMessage: data.error_message as string | undefined,
      requestId:    data.request_id    as string | undefined,
    }
  }
  return { errorMessage: err instanceof Error ? err.message : String(err) }
}

/**
 * Formats a Plaid error into a human-readable string for API error responses.
 * Preserves request_id so callers can surface it to users for support.
 */
export function formatPlaidError(err: unknown): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  return data ? JSON.stringify(data) : (err instanceof Error ? err.message : JSON.stringify(err))
}
