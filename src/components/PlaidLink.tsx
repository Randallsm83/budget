'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'

interface Props {
  accountId: string
  onConnected: () => void
}

export function PlaidLink({ accountId, onConnected }: Props) {
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [exchanging, setExchanging] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/plaid/link-token', { method: 'POST' })
      .then((r) => r.json())
      .then((d) => setLinkToken(d.link_token))
      .catch(() => setError('Failed to initialize Plaid'))
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

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => open()}
        disabled={!ready || exchanging || !!error}
        className="border border-[#b3a1e6] text-[#b3a1e6] hover:bg-[#b3a1e6]/10 font-medium px-3 py-1.5
                   rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {exchanging ? 'Connecting…' : '🏦 Connect Bank'}
      </button>
      {error && <p className="text-xs text-[#ce6f8f]">{error}</p>}
    </div>
  )
}
