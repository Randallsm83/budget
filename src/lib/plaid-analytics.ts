/**
 * Plaid Link conversion logging.
 *
 * Currently logs to the browser console in a structured format.
 * To integrate with your analytics platform (Segment, Amplitude, PostHog, etc.),
 * replace the console.log calls with your platform's track() call.
 *
 * Key events and their meaning:
 *   OPEN              - User opened Plaid Link
 *   SELECT_INSTITUTION - User chose a financial institution
 *   SUBMIT_CREDENTIALS - User submitted credentials (non-OAuth)
 *   OPEN_OAUTH        - User was redirected to institution OAuth page
 *   HANDOFF           - User completed Link successfully (use for conversion rate)
 *   EXIT              - User exited without completing (use for drop-off analysis)
 *   ERROR             - A recoverable error occurred in Link
 *   TRANSITION_VIEW   - User moved to a new pane (metadata.view_name for detail)
 */

interface LinkEventMetadata {
  institution_name?: string | null
  institution_id?: string | null
  link_session_id?: string
  request_id?: string
  error_type?: string | null
  error_code?: string | null
  exit_status?: string | null
  view_name?: string | null
  mfa_type?: string | null
}

interface LinkExitMetadata {
  institution?: { name: string; institution_id: string } | null
  status?: string | null
  link_session_id?: string
  request_id?: string
}

interface LinkExitError {
  error_type?: string
  error_code?: string
  error_message?: string
  display_message?: string | null
}

export function logLinkEvent(eventName: string, metadata: LinkEventMetadata) {
  const payload = {
    event: `plaid_link_${eventName.toLowerCase()}`,
    institution: metadata.institution_name,
    institution_id: metadata.institution_id,
    link_session_id: metadata.link_session_id,
    view_name: metadata.view_name,
    mfa_type: metadata.mfa_type,
    error_code: metadata.error_code,
    timestamp: new Date().toISOString(),
  }
  // Filter out nullish fields for readability
  const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v != null))
  console.log('[plaid/analytics] event', clean)
}

export function logLinkExit(error: LinkExitError | null, metadata: LinkExitMetadata) {
  const payload = {
    event: 'plaid_link_exit',
    institution: metadata.institution?.name,
    institution_id: metadata.institution?.institution_id,
    exit_status: metadata.status,
    link_session_id: metadata.link_session_id,
    error_type: error?.error_type,
    error_code: error?.error_code,
    error_message: error?.error_message,
    timestamp: new Date().toISOString(),
  }
  const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v != null))
  console.log('[plaid/analytics] exit', clean)
}
