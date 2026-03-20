'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { PlaidConsentModal } from './PlaidConsentModal'

interface Props {
  accountId: string
  onConnected: () => void
}

export function PlaidLink({ accountId, onConnected }: Props) {
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [exchanging, setExchanging] = useState(false)
  const [error, setError] = useState('')
  const [showConsent, setShowConsent] = useState(false)

  useEffect(() => {
    fetch('/api/plaid/link-token', { method: 'POST' })
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok || !d.link_token) {
          setError(d.error ?? 'Failed to get link token')
        } else {
          setLinkToken(d.link_token)
        }
      })
      .catch((e) => setError(String(e)))
  }, [])

  const onSuccess = useCallback(
    async (publicToken: string) => {
      setExchanging(true)
      setError('')
      const res = await fetch('/api/plaid/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_token: publicToken, accountId }),
      })
      setExchanging(false)
      if (!res.ok) {
        setError('Failed to connect bank account')
        return
      }
      onConnected()
    },
    [accountId, onConnected],
  )

  const { open, ready } = usePlaidLink({ token: linkToken ?? '', onSuccess })

  function handleOpen() {
    // Persist accountId so the OAuth callback page can recover it
    sessionStorage.setItem('plaid_oauth_account_id', accountId)
    open()
  }

  return (
    <>
      {showConsent && (
        <PlaidConsentModal
          onConfirm={() => { setShowConsent(false); handleOpen() }}
          onCancel={() => setShowConsent(false)}
        />
      )}
      <button
        onClick={() => setShowConsent(true)}
        disabled={!ready || exchanging}
        title={error || undefined}
        className="border border-[#b3a1e6] text-[#b3a1e6] hover:bg-[#b3a1e6]/10 font-medium px-3 py-1.5
                   rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {exchanging ? 'Connecting…' : error ? '⚠️ Connect Bank' : '🏦 Connect Bank'}
      </button>
    </>
  )
}
