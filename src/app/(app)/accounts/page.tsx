'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AddAccountModal } from '@/components/AddAccountModal'
import { closeAccount, deleteAccount } from '@/lib/actions'
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
  const router = useRouter()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})

  function handleClose(id: string) {
    startTransition(async () => {
      await closeAccount(id)
      router.refresh()
      loadAccounts()
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteAccount(id)
        router.refresh()
        loadAccounts()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Cannot delete'
        setErrors((prev) => ({ ...prev, [id]: msg }))
        setTimeout(() => setErrors((prev) => ({ ...prev, [id]: '' })), 3000)
      }
    })
  }

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
              <div
                key={account.id}
                className="flex items-center justify-between bg-[#1f2039] border border-[#3a3b58] rounded-lg px-4 py-3
                           hover:border-[#b3a1e6] hover:bg-[#252640] transition-all group"
              >
                <Link href={`/accounts/${account.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#ecf0f1]">{account.name}</p>
                  <p className="text-xs text-[#8a8fad] mt-0.5">
                    {TYPE_LABELS[account.type] ?? account.type}
                    {errors[account.id] && (
                      <span className="ml-2 text-[#ce6f8f]">{errors[account.id]}</span>
                    )}
                  </p>
                </Link>
                <div className="flex items-center gap-3">
                  <p className={`text-sm font-semibold tabular-nums ${
                    account.balance < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'
                  }`}>
                    {formatMoney(account.balance)}
                  </p>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleClose(account.id)}
                      title="Close account"
                      className="text-xs text-[#8a8fad] hover:text-[#f2ce00] px-1.5 py-0.5 rounded
                                 hover:bg-[#f2ce00]/10 transition-colors"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => handleDelete(account.id)}
                      title="Delete account"
                      className="text-xs text-[#8a8fad] hover:text-[#ce6f8f] px-1.5 py-0.5 rounded
                                 hover:bg-[#ce6f8f]/10 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
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
