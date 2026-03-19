'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePlaidLink } from 'react-plaid-link'

/**
 * Landing page for Plaid OAuth redirects.
 *
 * When a bank requires OAuth, Plaid redirects the user to their bank's site
 * and then back to PLAID_REDIRECT_URI (this page) with ?oauth_state_id=...
 * We resume the Link flow here using the receivedRedirectUri option.
 *
 * The accountId that was being linked is recovered from sessionStorage
 * (stored by PlaidLink.tsx before the flow began).
 */
export default function OAuthCallbackPage() {
  const router = useRouter()
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Initialise synchronously from browser APIs — lazy initialisers run client-side only
  const [receivedRedirectUri] = useState<string | undefined>(() =>
    typeof window !== 'undefined' ? window.location.href : undefined
  )
  const [accountId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? sessionStorage.getItem('plaid_oauth_account_id') : null
  )

  useEffect(() => {
    fetch('/api/plaid/link-token', { method: 'POST' })
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok || !d.link_token) {
          setError(d.error ?? 'Failed to resume bank connection')
        } else {
          setLinkToken(d.link_token)
        }
      })
      .catch((e) => setError(String(e)))
  }, [])

  const onSuccess = useCallback(
    async (publicToken: string) => {
      if (!accountId) {
        router.push('/accounts')
        return
      }
      const res = await fetch('/api/plaid/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_token: publicToken, accountId }),
      })
      sessionStorage.removeItem('plaid_oauth_account_id')
      if (res.ok) {
        router.push(`/accounts/${accountId}`)
      } else {
        setError('Failed to connect bank account')
      }
    },
    [accountId, router],
  )

  const onExit = useCallback(() => {
    router.push(accountId ? `/accounts/${accountId}` : '/accounts')
  }, [accountId, router])

  const { open, ready } = usePlaidLink({
    token: linkToken ?? '',
    receivedRedirectUri,
    onSuccess,
    onExit,
  })

  // Auto-open as soon as Link is ready
  useEffect(() => {
    if (ready) open()
  }, [ready, open])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-[#ce6f8f] text-sm">{error}</p>
        <button
          onClick={() => router.push('/accounts')}
          className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] transition-colors"
        >
          ← Back to accounts
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-[#8a8fad] text-sm animate-pulse">Resuming bank connection…</p>
    </div>
  )
}
