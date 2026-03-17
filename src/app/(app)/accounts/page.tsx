'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AddAccountModal } from '@/components/AddAccountModal'
import { formatMoney } from '@/lib/budget'

interface Account {
  id: string
  name: string
  type: string
  balance: number
  closed: boolean
}

const TYPE_LABELS: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit Card',
  cash: 'Cash',
  other: 'Other',
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  async function loadAccounts() {
    const res = await fetch('/api/accounts')
    if (res.ok) {
      const data = await res.json()
      setAccounts(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  const active = accounts.filter((a) => !a.closed)
  const netWorth = active.reduce((sum, a) => sum + a.balance, 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-[#1f2039] border-b border-[#3a3b58] px-6 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#ecf0f1]">Accounts</h2>
          {!loading && (
            <p className="text-xs text-[#8a8fad] mt-0.5">
              Net Worth:{' '}
              <span className={netWorth >= 0 ? 'text-[#5ccc96]' : 'text-[#ce6f8f]'}>
                {formatMoney(netWorth)}
              </span>
            </p>
          )}
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold px-4 py-1.5 rounded-lg text-sm transition-colors"
        >
          + Add Account
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto p-6">
        {loading && (
          <p className="text-[#8a8fad] text-sm">Loading accounts…</p>
        )}

        {!loading && accounts.length === 0 && (
          <div className="text-center py-12 text-[#8a8fad]">
            <p className="text-lg mb-2">No accounts yet</p>
            <p className="text-sm">Add your first account to get started.</p>
          </div>
        )}

        {!loading && accounts.length > 0 && (
          <div className="space-y-2 max-w-2xl">
            {active.map((account) => (
              <Link
                key={account.id}
                href={`/accounts/${account.id}`}
                className="flex items-center justify-between bg-[#1f2039] border border-[#3a3b58] rounded-lg px-4 py-3
                           hover:border-[#b3a1e6] hover:bg-[#252640] transition-all"
              >
                <div>
                  <p className="text-sm font-medium text-[#ecf0f1]">{account.name}</p>
                  <p className="text-xs text-[#8a8fad] mt-0.5">{TYPE_LABELS[account.type] ?? account.type}</p>
                </div>
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    account.balance < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'
                  }`}
                >
                  {formatMoney(account.balance)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <AddAccountModal
          onClose={() => {
            setShowModal(false)
            loadAccounts()
          }}
        />
      )}
    </div>
  )
}
