'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateTrackingBalance } from '@/lib/actions'
import { formatMoney } from '@/lib/budget'

interface Props {
  accountId: string
  accountType: string
  currentBalance: number // milliunits
  onClose: () => void
}

// Liability types: user enters amount owed (positive), stored as negative
const LIABILITY_TYPES = new Set(['loan'])

const VALUE_LABEL: Record<string, string> = {
  investment:  'Current Value ($)',
  real_estate: 'Estimated Value ($)',
  vehicle:     'Estimated Value ($)',
  loan:        'Outstanding Balance ($)',
  other:       'Current Value ($)',
}

const VALUE_HINT: Record<string, string> = {
  investment:  'Enter the current market value from your latest statement.',
  real_estate: 'Enter the current estimated market value.',
  vehicle:     'Enter the current estimated value (e.g. from KBB or CarMax).',
  loan:        'Enter how much you currently owe (will be stored as a negative balance).',
  other:       '',
}

const NOTE_PLACEHOLDER: Record<string, string> = {
  investment:  'e.g. Q1 statement, Fidelity screenshot…',
  real_estate: 'e.g. Zillow estimate, recent appraisal…',
  vehicle:     'e.g. KBB valuation, dealer quote…',
  loan:        'e.g. Loan statement date, refinance…',
  other:       '',
}

export function UpdateBalanceModal({ accountId, accountType, currentBalance, onClose }: Props) {
  const router = useRouter()
  const isLiability = LIABILITY_TYPES.has(accountType)
  const today = new Date().toISOString().substring(0, 10)

  // Pre-populate with the absolute current value so the field is always positive
  const initValue = (Math.abs(currentBalance) / 1000).toFixed(2)

  const [value, setValue] = useState(initValue)
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  // Compute new balance in milliunits:
  //   loans   → always negative (debt)
  //   assets  → always positive
  const rawDollars = parseFloat(value.replace(/[$,]/g, '')) || 0
  const newBalanceMilliunits = isLiability
    ? -Math.abs(Math.round(rawDollars * 1000))
    : Math.round(rawDollars * 1000)

  const delta = newBalanceMilliunits - currentBalance
  const deltaZero = delta === 0
  const deltaPositive = delta > 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!value || isNaN(parseFloat(value))) return setError('Enter a valid amount.')
    if (deltaZero) return setError('New value matches the current balance — no change needed.')
    setError('')
    startTransition(async () => {
      try {
        await updateTrackingBalance(accountId, newBalanceMilliunits, note || undefined, date)
        router.refresh()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update balance.')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#1f2039] border border-[#3a3b58] rounded-xl w-full max-w-sm mx-4 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-[#ecf0f1] mb-1">Update Balance</h2>
        <p className="text-xs text-[#8a8fad] mb-5">
          Current:{' '}
          <span className={currentBalance < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'}>
            {formatMoney(currentBalance)}
          </span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* New value */}
          <div>
            <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
              {VALUE_LABEL[accountType] ?? 'New Balance ($)'}
            </label>
            <input
              type="text"
              autoFocus
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="0.00"
              className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-[#b3a1e6] focus:ring-1 focus:ring-[#b3a1e6]
                         transition-colors tabular-nums text-right"
            />
            {VALUE_HINT[accountType] && (
              <p className="text-xs text-[#5a5b78] mt-1">{VALUE_HINT[accountType]}</p>
            )}
          </div>

          {/* Live delta preview */}
          {!deltaZero && (
            <div className={`text-xs px-3 py-2 rounded-lg border flex items-center justify-between ${
              deltaPositive
                ? 'border-[#5ccc96]/30 bg-[#5ccc96]/10 text-[#5ccc96]'
                : 'border-[#ce6f8f]/30 bg-[#ce6f8f]/10 text-[#ce6f8f]'
            }`}>
              <span>Adjustment</span>
              <span className="tabular-nums font-semibold">
                {deltaPositive ? '+' : ''}{formatMoney(delta)}
              </span>
            </div>
          )}

          {/* Date */}
          <div>
            <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-[#b3a1e6] transition-colors"
            />
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
              Note <span className="normal-case text-[#3a3b58]">(optional)</span>
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={NOTE_PLACEHOLDER[accountType] ?? ''}
              className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-[#b3a1e6] transition-colors"
            />
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
              disabled={isPending || deltaZero}
              className="flex-1 bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold py-2 rounded-lg text-sm
                         transition-colors disabled:opacity-60"
            >
              {isPending ? 'Saving…' : 'Update Balance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
