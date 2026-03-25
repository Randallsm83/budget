'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateTransactionCategory, deleteTransaction, toggleTransfer } from '@/lib/actions'
import { formatMoney } from '@/lib/budget'

interface Txn {
  id: string
  date: string
  payee: string
  amount: number
  memo: string
  cleared: boolean
  isTransfer: boolean
  categoryId: string | null
  categoryName: string | null
  groupName: string | null
  accountId: string
  accountName: string
  accountType: string
}

interface Category {
  id: string
  name: string
  groupName: string
  isIncome: boolean
  isSystem: boolean
  isCCPayment: boolean
}

interface Account {
  id: string
  name: string
  type: string
}

interface Filters {
  category: string | null
  month: string | null
  account: string | null
}

interface Props {
  transactions: Txn[]
  allCategories: Category[]
  allAccounts: Account[]
  filters: Filters
}

// ---------------------------------------------------------------------------
// Single transaction row
// ---------------------------------------------------------------------------
function TxnRow({ txn, allCategories, onDeleted }: {
  txn: Txn
  allCategories: Category[]
  onDeleted: (id: string) => void
}) {
  const router = useRouter()
  const [localCatId, setLocalCatId] = useState(txn.categoryId)
  const [localIsTransfer, setLocalIsTransfer] = useState(txn.isTransfer)
  const [confirming, setConfirming] = useState(false)
  const [, startTransition] = useTransition()

  const displayCat = localIsTransfer
    ? '↔ Transfer'
    : (allCategories.find((c) => c.id === localCatId)?.name ?? (localCatId ? '?' : ''))

  function handleCatChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value || null
    setLocalCatId(id)
    startTransition(async () => {
      await updateTransactionCategory(txn.id, id)
      router.refresh()
    })
  }

  function handleToggleTransfer() {
    const next = !localIsTransfer
    setLocalIsTransfer(next)
    if (next) setLocalCatId(null)
    startTransition(async () => {
      await toggleTransfer(txn.id)
      router.refresh()
    })
  }

  function handleDelete() {
    setConfirming(false)
    startTransition(async () => {
      await deleteTransaction(txn.id)
      onDeleted(txn.id)
      router.refresh()
    })
  }

  // Group categories for <optgroup>
  const grouped = allCategories.reduce<Record<string, Category[]>>((acc, c) => {
    if (c.isSystem) return acc
    const g = c.groupName || 'Other'
    ;(acc[g] ??= []).push(c)
    return acc
  }, {})

  return (
    <div className="grid grid-cols-[6rem_1fr_1fr_6.5rem_5.5rem_2.5rem] gap-2 px-4 sm:px-6 py-2
                    border-b border-[#1f2039] hover:bg-[#1f2039] transition-colors items-center
                    text-sm group">
      {/* Date */}
      <span className="text-[#8a8fad] tabular-nums text-xs">{txn.date}</span>

      {/* Payee + account */}
      <div className="min-w-0">
        <p className="text-[#ecf0f1] truncate">{txn.payee || '—'}</p>
        <Link
          href={`/accounts/${txn.accountId}`}
          className="text-[10px] text-[#5a5b78] hover:text-[#b3a1e6] transition-colors truncate block"
        >
          {txn.accountName}
        </Link>
      </div>

      {/* Category */}
      <div className="min-w-0">
        {localIsTransfer ? (
          <span className="text-[#8a8fad] text-xs">↔ Transfer</span>
        ) : (
          <select
            value={localCatId ?? ''}
            onChange={handleCatChange}
            className="w-full bg-transparent text-[#8a8fad] text-xs rounded px-1 py-0.5
                       hover:bg-[#2a2b45] focus:bg-[#2a2b45] focus:outline-none focus:text-[#ecf0f1]
                       cursor-pointer truncate border-0"
          >
            <option value="">Uncategorized</option>
            {Object.entries(grouped).map(([group, cats]) => (
              <optgroup key={group} label={group}>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>

      {/* Amount */}
      <span className={`text-right tabular-nums font-medium text-sm ${
        txn.amount < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'
      }`}>
        {formatMoney(txn.amount)}
      </span>

      {/* Cleared dot */}
      <span
        className={`text-center text-xs ${txn.cleared ? 'text-[#5ccc96]' : 'text-[#3a3b58]'}`}
        title={txn.cleared ? 'Cleared' : 'Uncleared'}
      >
        {txn.cleared ? '●' : '○'}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
        <button
          onClick={handleToggleTransfer}
          title={localIsTransfer ? 'Unmark transfer' : 'Mark as transfer'}
          className="text-xs text-[#8a8fad] hover:text-[#b3a1e6] px-1 py-0.5"
        >↔</button>
        {confirming ? (
          <>
            <button onClick={handleDelete} className="text-xs text-[#ce6f8f] hover:text-white px-1 py-0.5 rounded bg-[#ce6f8f]/20">✓</button>
            <button onClick={() => setConfirming(false)} className="text-xs text-[#8a8fad] px-1 py-0.5">✕</button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)} className="text-xs text-[#8a8fad] hover:text-[#ce6f8f] px-1 py-0.5">✕</button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function TransactionsList({ transactions: initialTxns, allCategories, allAccounts, filters }: Props) {
  const router = useRouter()
  const [txns, setTxns] = useState(initialTxns)
  const [search, setSearch] = useState('')

  // Client-side text search on top of server-side category/account/month filters
  const visible = useMemo(() => {
    if (!search.trim()) return txns
    const q = search.toLowerCase()
    return txns.filter((t) =>
      t.payee.toLowerCase().includes(q) ||
      t.memo.toLowerCase().includes(q) ||
      t.accountName.toLowerCase().includes(q) ||
      (t.categoryName ?? '').toLowerCase().includes(q)
    )
  }, [txns, search])

  function navigate(key: string, value: string | null) {
    const params = new URLSearchParams()
    const cur: Record<string, string | null> = {
      category: filters.category,
      month:    filters.month,
      account:  filters.account,
      [key]: value,
    }
    Object.entries(cur).forEach(([k, v]) => { if (v) params.set(k, v) })
    router.push(`/transactions${params.size ? '?' + params.toString() : ''}`)
  }

  const totalIn  = visible.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalOut = visible.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-[#1f2039] border-b border-[#3a3b58] px-4 sm:px-6 py-3
                      flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#ecf0f1]">Transactions</h2>
          <p className="text-xs text-[#8a8fad] mt-0.5">
            {visible.length} transaction{visible.length !== 1 ? 's' : ''}
            {visible.length > 0 && (
              <> · <span className="text-[#5ccc96]">+{formatMoney(totalIn)}</span>
              {' '}<span className="text-[#ce6f8f]">-{formatMoney(totalOut)}</span></>
            )}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 ml-auto items-center">
          {/* Category filter */}
          <select
            value={filters.category ?? ''}
            onChange={(e) => navigate('category', e.target.value || null)}
            className="bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] text-xs rounded px-2 py-1.5
                       focus:outline-none focus:border-[#b3a1e6]"
          >
            <option value="">All categories</option>
            {Object.entries(
              allCategories
                .filter((c) => !c.isSystem)
                .reduce<Record<string, Category[]>>((acc, c) => {
                  ;(acc[c.groupName || 'Other'] ??= []).push(c)
                  return acc
                }, {})
            ).map(([group, cats]) => (
              <optgroup key={group} label={group}>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Month filter */}
          <input
            type="month"
            value={filters.month ?? ''}
            onChange={(e) => navigate('month', e.target.value || null)}
            className="bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] text-xs rounded px-2 py-1.5
                       focus:outline-none focus:border-[#b3a1e6]"
          />

          {/* Account filter */}
          <select
            value={filters.account ?? ''}
            onChange={(e) => navigate('account', e.target.value || null)}
            className="bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] text-xs rounded px-2 py-1.5
                       focus:outline-none focus:border-[#b3a1e6]"
          >
            <option value="">All accounts</option>
            {allAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payee, memo…"
            className="bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] text-xs rounded px-2 py-1.5
                       focus:outline-none focus:border-[#b3a1e6] w-40"
          />

          {/* Clear filters */}
          {(filters.category || filters.month || filters.account) && (
            <button
              onClick={() => router.push('/transactions')}
              className="text-xs text-[#8a8fad] hover:text-[#ce6f8f] px-2 py-1.5 border border-[#3a3b58]
                         hover:border-[#ce6f8f] rounded transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div className="flex-shrink-0 hidden sm:grid grid-cols-[6rem_1fr_1fr_6.5rem_5.5rem_2.5rem] gap-2
                      px-4 sm:px-6 py-2 bg-[#1a1b2e] border-b border-[#3a3b58]
                      text-[9px] font-bold text-[#8a8fad] uppercase tracking-widest">
        <span>Date</span>
        <span>Payee / Account</span>
        <span>Category</span>
        <span className="text-right">Amount</span>
        <span className="text-center">Cleared</span>
        <span />
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-auto">
        {visible.length === 0 ? (
          <div className="py-16 text-center text-[#8a8fad] text-sm">
            {txns.length === 0
              ? 'No transactions match the selected filters.'
              : 'No results for that search.'}
          </div>
        ) : (
          visible.map((t) => (
            <TxnRow
              key={t.id}
              txn={t}
              allCategories={allCategories}
              onDeleted={(id) => setTxns((prev) => prev.filter((x) => x.id !== id))}
            />
          ))
        )}
      </div>
    </div>
  )
}
