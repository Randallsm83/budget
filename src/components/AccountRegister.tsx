'use client'

import { useState, useTransition } from 'react'
import { AddTransactionModal } from './AddTransactionModal'
import { deleteTransaction } from '@/lib/actions'
import { formatMoney } from '@/lib/budget'

interface Transaction {
  id: string
  date: string
  payee: string
  amount: number
  cleared: boolean
  reconciled: boolean
  memo: string
  categoryName: string | null
}

interface Account {
  id: string
  name: string
  type: string
  balance: number
}

interface Props {
  account: Account
  transactions: Transaction[]
  allAccounts: { id: string; name: string }[]
  allCategories: { id: string; name: string; groupName: string }[]
}

const TYPE_LABELS: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit Card',
  cash: 'Cash',
  other: 'Other',
}

function TransactionRow({
  txn,
  onDelete,
}: {
  txn: Transaction
  onDelete: (id: string) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  return (
    <div
      className={`grid grid-cols-[7rem_1fr_1fr_7rem_4rem] gap-2 px-4 py-2.5 border-b border-[#1f2039]
                  hover:bg-[#1f2039] transition-colors items-center group
                  ${isPending ? 'opacity-50' : ''}`}
    >
      <span className="text-xs text-[#8a8fad] tabular-nums">{txn.date}</span>

      <div className="min-w-0">
        <p className="text-sm text-[#ecf0f1] truncate">{txn.payee || '—'}</p>
        {txn.memo && <p className="text-xs text-[#8a8fad] truncate">{txn.memo}</p>}
      </div>

      <span className="text-xs text-[#8a8fad] truncate">
        {txn.categoryName ?? <span className="text-[#f2ce00]">Inflow</span>}
      </span>

      <span
        className={`text-sm tabular-nums text-right font-medium ${
          txn.amount < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'
        }`}
      >
        {formatMoney(txn.amount)}
      </span>

      {/* Delete */}
      <div className="flex justify-end">
        {confirming ? (
          <div className="flex gap-1">
            <button
              onClick={() => {
                setConfirming(false)
                startTransition(() => onDelete(txn.id))
              }}
              className="text-xs text-[#ce6f8f] hover:text-white px-1.5 py-0.5 rounded bg-[#ce6f8f]/20"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-xs text-[#8a8fad] hover:text-white px-1.5 py-0.5"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="text-xs text-[#3a3b58] hover:text-[#ce6f8f] opacity-0 group-hover:opacity-100 transition-all"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

export function AccountRegister({ account, transactions, allAccounts, allCategories }: Props) {
  const [showModal, setShowModal] = useState(false)
  const [txns, setTxns] = useState(transactions)
  const [, startTransition] = useTransition()

  async function handleDelete(id: string) {
    startTransition(async () => {
      await deleteTransaction(id)
      setTxns((prev) => prev.filter((t) => t.id !== id))
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-[#1f2039] border-b border-[#3a3b58] px-6 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#ecf0f1]">{account.name}</h2>
          <p className="text-xs text-[#8a8fad] mt-0.5">
            {TYPE_LABELS[account.type] ?? account.type} ·{' '}
            <span
              className={account.balance < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'}
            >
              {formatMoney(account.balance)}
            </span>
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold px-4 py-1.5 rounded-lg text-sm transition-colors"
        >
          + Add Transaction
        </button>
      </div>

      {/* Column headers */}
      <div className="flex-shrink-0 grid grid-cols-[7rem_1fr_1fr_7rem_4rem] gap-2 px-4 py-2
                      bg-[#1a1b2e] border-b border-[#3a3b58]
                      text-xs font-semibold text-[#8a8fad] uppercase tracking-wider">
        <span>Date</span>
        <span>Payee / Memo</span>
        <span>Category</span>
        <span className="text-right">Amount</span>
        <span />
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-auto">
        {txns.length === 0 && (
          <div className="text-center py-12 text-[#8a8fad] text-sm">
            No transactions yet. Add one to get started.
          </div>
        )}
        {txns.map((txn) => (
          <TransactionRow key={txn.id} txn={txn} onDelete={handleDelete} />
        ))}
      </div>

      {showModal && (
        <AddTransactionModal
          accounts={allAccounts}
          categories={allCategories}
          defaultAccountId={account.id}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
