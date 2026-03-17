'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addAccount } from '@/lib/actions'

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
]

export function AddAccountModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
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
        <h2 className="text-lg font-semibold text-[#ecf0f1] mb-5">Add Account</h2>

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
              Current Balance ($)
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
            <p className="text-xs text-[#8a8fad] mt-1">
              Negative for credit card debt (e.g. -1500.00)
            </p>
          </div>

          {error && (
            <p className="text-sm text-[#ce6f8f] bg-[#ce6f8f]/10 border border-[#ce6f8f]/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

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
      </div>
    </div>
  )
}
