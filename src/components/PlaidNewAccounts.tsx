'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { clearNewAccountsAvailable } from '@/lib/actions'

interface Props {
  accountId: string
  onComplete: () => void
}

export function PlaidNewAccounts({ accountId, onComplete }: Props) {
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch('/api/plaid/update-link-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, accountSelectionEnabled: true }),
    })
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok || !d.link_token) setError(d.error ?? 'Failed to get link token')
        else setLinkToken(d.link_token)
      })
      .catch((e) => setError(String(e)))
  }, [accountId])

  const onSuccess = useCallback(async () => {
    // Clear the prompt immediately — user has granted access to new accounts
    try { await clearNewAccountsAvailable(accountId) } catch { /* non-critical */ }
    setDone(true)
    onComplete()
  }, [accountId, onComplete])

  const { open, ready } = usePlaidLink({ token: linkToken ?? '', onSuccess })

  function handleOpen() {
    sessionStorage.setItem('plaid_oauth_account_id', accountId)
    open()
  }

  if (done) return null

  if (error) {
    return (
      <button
        disabled
        title={error}
        className="border border-[#5a5b78] text-[#5a5b78] font-medium px-2.5 sm:px-3 py-1.5 rounded-lg text-sm opacity-50 cursor-not-allowed"
      >
        ＋ Add Accounts
      </button>
    )
  }

  return (
    <button
      onClick={handleOpen}
      disabled={!ready}
      title="New accounts were detected at this bank — click to connect them"
      className="border border-[#42b3c2] text-[#42b3c2] hover:bg-[#42b3c2]/10 font-medium
                 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors
                 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {!linkToken ? 'Loading…' : '＋ Add Accounts'}
    </button>
  )
}
