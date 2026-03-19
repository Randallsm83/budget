'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'

interface Props {
  accountId: string
  onRelinkComplete: () => void
}

export function PlaidRelink({ accountId, onRelinkComplete }: Props) {
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/plaid/update-link-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    })
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok || !d.link_token) setError(d.error ?? 'Failed to get link token')
        else setLinkToken(d.link_token)
      })
      .catch((e) => setError(String(e)))
  }, [accountId])

  // Update mode: Plaid re-authenticates the existing Item — no token exchange needed
  const onSuccess = useCallback(() => {
    onRelinkComplete()
  }, [onRelinkComplete])

  const { open, ready } = usePlaidLink({ token: linkToken ?? '', onSuccess })

  function handleOpen() {
    sessionStorage.setItem('plaid_oauth_account_id', accountId)
    open()
  }

  return (
    <button
      onClick={handleOpen}
      disabled={!ready}
      title={error || 'Re-authenticate your bank connection'}
      className="border border-[#e39400] text-[#e39400] hover:bg-[#e39400]/10 font-medium
                 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors
                 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {error ? '⚠️ Relink failed' : !linkToken ? 'Loading…' : '⚠️ Re-link Bank'}
    </button>
  )
}
