'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { usePlaidLink } from 'react-plaid-link'
import { addAccount } from '@/lib/actions'

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'loan', label: 'Loan / Mortgage' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'investment', label: 'Investment' },
  { value: 'other', label: 'Other' },
]

function PlaidConnectSection({ onDone, onError }: { onDone: () => void; onError: (msg: string) => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/plaid/link-token', { method: 'POST' })
      .then(async (r) => {
        if (cancelled) return
        const d = await r.json()
        if (d.link_token) setLinkToken(d.link_token)
        else onError(d.error ?? 'Failed to initialize Plaid')
      })
      .catch((e) => { if (!cancelled) onError(String(e)) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSuccess = useCallback(async (publicToken: string) => {
    setConnecting(true)
    const res = await fetch('/api/plaid/create-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_token: publicToken }),
    })
    const data = await res.json()
    setConnecting(false)
    if (!res.ok) { onError(data.error ?? 'Failed to create accounts'); return }
    onDone()
  }, [onDone, onError])

  const { open, ready } = usePlaidLink({ token: linkToken ?? '', onSuccess })

  return (
    <div className="py-4 flex flex-col items-center gap-3">
      <p className="text-sm text-[#8a8fad] text-center">
        Connect your bank and Coffer will automatically import your accounts and balances.
      </p>
      <button
        onClick={() => open()}
        disabled={!ready || connecting}
        className="bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold px-6 py-2.5 rounded-lg text-sm
                   transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {connecting ? 'Connecting…' : !linkToken ? 'Loading…' : '🏦 Connect Bank'}
      </button>
    </div>
  )
}

const BALANCE_META: Record<string, { label: string; hint: string }> = {
  checking:    { label: 'Current Balance', hint: 'Enter the current account balance.' },
  savings:     { label: 'Current Balance', hint: 'Enter the current account balance.' },
  cash:        { label: 'Cash on Hand',    hint: 'How much cash do you currently have?' },
  credit_card: { label: 'Current Balance', hint: 'Enter as negative if you owe money (e.g. -1500.00).' },
  loan:        { label: 'Outstanding Balance', hint: 'Enter the remaining amount owed as negative (e.g. -250000.00).' },
  investment:  { label: 'Current Value',   hint: 'Estimated market value of this account.' },
  real_estate: { label: 'Estimated Value', hint: 'Current market value of the property.' },
  vehicle:     { label: 'Estimated Value', hint: 'Current market value of the vehicle.' },
  other:       { label: 'Current Value',   hint: '' },
}

export function AddAccountModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [mode, setMode] = useState<'manual' | 'plaid'>('manual')
  const [name, setName] = useState('')
  const [type, setType] = useState('checking')
  const [balance, setBalance] = useState('0.00')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Account name is required.')
    setError('')
    startTransition(async () => {
      try {
        await addAccount({ name: name.trim(), type, startingBalanceDollars: balance })
        router.refresh()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create account.')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#1f2039] border border-[#3a3b58] rounded-xl w-full max-w-sm mx-4 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-[#ecf0f1] mb-4">Add Account</h2>

        {/* Mode tabs */}
        <div className="flex rounded-lg bg-[#2a2b45] p-0.5 mb-5">
          {(['manual', 'plaid'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError('') }}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-[#1f2039] text-[#ecf0f1] shadow'
                  : 'text-[#8a8fad] hover:text-[#ecf0f1]'
              }`}
            >
              {m === 'manual' ? 'Manual' : '🏦 Connect via Plaid'}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-[#ce6f8f] bg-[#ce6f8f]/10 border border-[#ce6f8f]/20 rounded-lg px-3 py-2 mb-4">
            {error}
          </p>
        )}

        {mode === 'plaid' ? (
          <>
            <PlaidConnectSection
              onDone={() => { router.refresh(); onClose() }}
              onError={(msg) => setError(msg)}
            />
            <button
              type="button"
              onClick={onClose}
              className="w-full mt-2 bg-[#2a2b45] hover:bg-[#3a3b58] text-[#8a8fad] font-medium py-2 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
              Account Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Chase Checking"
              className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-[#b3a1e6] focus:ring-1 focus:ring-[#b3a1e6] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
              Account Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-[#b3a1e6] focus:ring-1 focus:ring-[#b3a1e6] transition-colors"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
              {BALANCE_META[type]?.label ?? 'Current Balance'} ($)
            </label>
            <input
              type="text"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="0.00"
              className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-[#b3a1e6] focus:ring-1 focus:ring-[#b3a1e6] transition-colors
                         tabular-nums text-right"
            />
            {BALANCE_META[type]?.hint && (
              <p className="text-xs text-[#8a8fad] mt-1">{BALANCE_META[type].hint}</p>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-[#2a2b45] hover:bg-[#3a3b58] text-[#8a8fad] font-medium py-2 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold py-2 rounded-lg text-sm
                         transition-colors disabled:opacity-60"
            >
              {isPending ? 'Adding…' : 'Add Account'}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  )
}
