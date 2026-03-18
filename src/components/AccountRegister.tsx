'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AddTransactionModal } from './AddTransactionModal'
import { CsvImportModal } from './CsvImportModal'
import { PlaidLink } from './PlaidLink'
import { applyPayeeRules, deleteTransaction, toggleCleared, updateAccount, updateTransactionCategory } from '@/lib/actions'
import { formatMoney } from '@/lib/budget'

interface Transaction {
  id: string
  accountId: string
  date: string
  payee: string
  amount: number
  cleared: boolean
  reconciled: boolean
  memo: string
  categoryId: string | null
  categoryName: string | null
}

interface Account {
  id: string
  name: string
  type: string
  balance: number
  clearedBalance: number
}

interface Props {
  account: Account
  transactions: Transaction[]
  allAccounts: { id: string; name: string }[]
  allCategories: { id: string; name: string; groupName: string; isIncome: boolean }[]
  connection: { id: string; lastSyncedAt: string | null } | null
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
  allAccounts,
  allCategories,
  onDelete,
  onEdit,
}: {
  txn: Transaction
  allAccounts: { id: string; name: string }[]
  allCategories: { id: string; name: string; groupName: string; isIncome: boolean }[]
  onDelete: (id: string) => void
  onEdit: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [editingCat, setEditingCat] = useState(false)
  const [localCatId, setLocalCatId] = useState(txn.categoryId)

  const localCatName = localCatId
    ? (allCategories.find((c) => c.id === localCatId)?.name ?? null)
    : null

  function handleToggleCleared() {
    startTransition(() => toggleCleared(txn.id))
  }

  function handleCategoryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const catId = e.target.value || null
    setLocalCatId(catId)
    setEditingCat(false)
    startTransition(async () => {
      await updateTransactionCategory(txn.id, catId)
      router.refresh()
    })
  }

  const categorySelect = (
    <select
      autoFocus
      defaultValue={localCatId ?? ''}
      onChange={handleCategoryChange}
      onBlur={() => setEditingCat(false)}
      className="bg-[#2a2b45] border border-[#b3a1e6] text-[#ecf0f1] rounded px-1 py-0.5 text-xs
                 focus:outline-none w-full"
    >
      <option value="">— Inflow / RTA —</option>
      {allCategories.some((c) => c.isIncome) && (
        <optgroup label="Income">
          {allCategories.filter((c) => c.isIncome).map((c) => (
            <option key={c.id} value={c.id}>{c.groupName}: {c.name}</option>
          ))}
        </optgroup>
      )}
      {allCategories.some((c) => !c.isIncome) && (
        <optgroup label="Expenses">
          {allCategories.filter((c) => !c.isIncome).map((c) => (
            <option key={c.id} value={c.id}>{c.groupName}: {c.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  )

  const categoryButton = (
    <button
      onClick={() => setEditingCat(true)}
      className={`text-left truncate w-full hover:underline transition-colors ${
        localCatName
          ? 'text-[#8a8fad]'
          : txn.amount < 0
            ? 'text-[#e39400]'
            : 'text-[#5ccc96]'
      }`}
      title="Click to assign category"
    >
      {localCatName ?? (txn.amount < 0 ? 'Uncategorized' : 'Inflow')}
    </button>
  )

  const clearedDot = (
    <button
      onClick={handleToggleCleared}
      title={txn.cleared ? 'Cleared — click to unclear' : 'Uncleared — click to clear'}
      className="flex items-center justify-center flex-shrink-0"
    >
      <span
        className={`w-2.5 h-2.5 rounded-full border transition-colors ${
          txn.cleared
            ? 'bg-[#5ccc96] border-[#5ccc96]'
            : 'bg-transparent border-[#8a8fad] hover:border-[#5ccc96]'
        }`}
      />
    </button>
  )

  const deleteButtons = confirming ? (
    <div className="flex gap-1">
      <button
        onClick={() => { setConfirming(false); startTransition(() => onDelete(txn.id)) }}
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
      title="Delete"
      className="text-xs text-[#8a8fad] hover:text-[#ce6f8f] transition-colors px-1"
    >
      ✕
    </button>
  )

  return (
    <div className={`border-b border-[#1f2039] hover:bg-[#1f2039] transition-colors group
                     ${isPending ? 'opacity-50' : ''}`}>

      {/* ── Mobile card layout ── */}
      <div className="sm:hidden px-3 py-2.5 flex items-start gap-2">
        <div className="mt-1">{clearedDot}</div>
        <div className="flex-1 min-w-0">
          {/* Row 1: payee + amount */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-[#ecf0f1] truncate">{txn.payee || '—'}</p>
              {txn.memo && <p className="text-xs text-[#8a8fad] truncate">{txn.memo}</p>}
            </div>
            <span className={`text-sm tabular-nums font-medium flex-shrink-0 ${
              txn.amount < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'
            }`}>
              {formatMoney(txn.amount)}
            </span>
          </div>
          {/* Row 2: date · category + actions */}
          <div className="flex items-center justify-between mt-1 gap-2">
            <div className="flex items-center gap-1 min-w-0 text-xs text-[#8a8fad] flex-1">
              <span className="flex-shrink-0 tabular-nums">{txn.date}</span>
              <span className="flex-shrink-0">·</span>
              <span className="truncate min-w-0">
                {editingCat ? categorySelect : categoryButton}
              </span>
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={onEdit}
                className="text-xs text-[#8a8fad] hover:text-[#b3a1e6] px-1.5 py-1 rounded transition-colors"
                title="Edit"
              >
                ✎
              </button>
              {deleteButtons}
            </div>
          </div>
        </div>
      </div>

      {/* ── Desktop grid layout ── */}
      <div className="hidden sm:grid grid-cols-[2rem_7rem_1fr_1fr_7rem_5rem] gap-2 px-4 py-2.5 items-center">
        {clearedDot}
        <span className="text-xs text-[#8a8fad] tabular-nums">{txn.date}</span>
        <div className="min-w-0">
          <p className="text-sm text-[#ecf0f1] truncate">{txn.payee || '—'}</p>
          {txn.memo && <p className="text-xs text-[#8a8fad] truncate">{txn.memo}</p>}
        </div>
        <span className="text-xs truncate">
          {editingCat ? categorySelect : categoryButton}
        </span>
        <span className={`text-sm tabular-nums text-right font-medium ${
          txn.amount < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'
        }`}>
          {formatMoney(txn.amount)}
        </span>
        <div className="flex justify-end items-center gap-1">
          <button
            onClick={onEdit}
            className="text-xs text-[#3a3b58] hover:text-[#b3a1e6] opacity-0 group-hover:opacity-100 transition-all px-1"
            title="Edit"
          >
            ✎
          </button>
          {confirming ? (
            <div className="flex gap-1">
              <button
                onClick={() => { setConfirming(false); startTransition(() => onDelete(txn.id)) }}
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
              title="Delete"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function AccountRegister({ account, transactions, allAccounts, allCategories, connection }: Props) {
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null)
  const [txns, setTxns] = useState(transactions)
  const [renamingAccount, setRenamingAccount] = useState(false)
  const [accountName, setAccountName] = useState(account.name)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [applyingRules, setApplyingRules] = useState(false)
  const [, startTransition] = useTransition()

  async function handleApplyRules() {
    setApplyingRules(true)
    setSyncResult(null)
    try {
      const result = await applyPayeeRules()
      setSyncResult(`Rules applied: ${result.updated} transaction${result.updated !== 1 ? 's' : ''} categorized`)
      router.refresh()
    } catch (err) {
      console.error('applyPayeeRules error:', err)
      setSyncResult('Error applying rules — check console')
    } finally {
      setApplyingRules(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    const res = await fetch('/api/plaid/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: account.id }),
    })
    const data = await res.json()
    setSyncing(false)
    if (res.ok) {
      let msg = `+${data.added} added, ${data.modified} updated, ${data.removed} removed`
      if (data.firstSync) msg += ' · Plaid is loading older history — sync again in a few minutes'
      setSyncResult(msg)
      router.refresh()
    } else {
      setSyncResult(`Sync failed: ${data.error ?? 'unknown error'}`)
    }
  }

  function commitRename(name: string) {
    setRenamingAccount(false)
    if (name.trim() && name.trim() !== account.name) {
      setAccountName(name.trim())
      startTransition(() => updateAccount(account.id, { name: name.trim(), type: account.type }))
      router.refresh()
    }
  }

  async function handleDelete(id: string) {
    startTransition(async () => {
      await deleteTransaction(id)
      setTxns((prev) => prev.filter((t) => t.id !== id))
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-[#1f2039] border-b border-[#3a3b58] px-4 sm:px-6 py-3
                      flex flex-wrap sm:flex-nowrap items-start sm:items-center justify-between gap-2">
        <div>
          {renamingAccount ? (
            <input
              autoFocus
              defaultValue={accountName}
              onBlur={(e) => commitRename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(e.currentTarget.value)
                if (e.key === 'Escape') setRenamingAccount(false)
              }}
              className="text-base font-semibold bg-[#2a2b45] border border-[#b3a1e6] text-[#ecf0f1]
                         rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#b3a1e6]"
            />
          ) : (
            <h2
              className="text-base font-semibold text-[#ecf0f1] cursor-default"
              onDoubleClick={() => setRenamingAccount(true)}
              title="Double-click to rename"
            >
              {accountName}
            </h2>
          )}
          <p className="text-xs text-[#8a8fad] mt-0.5">
            {TYPE_LABELS[account.type] ?? account.type}
            {' · Balance: '}
            <span className={account.balance < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'}>
              {formatMoney(account.balance)}
            </span>
            {' · Cleared: '}
            <span className={account.clearedBalance < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'}>
              {formatMoney(account.clearedBalance)}
            </span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
            <button
              onClick={handleApplyRules}
              disabled={applyingRules}
              title="Re-categorize uncategorized transactions using saved payee rules"
              className="border border-[#3a3b58] hover:border-[#b3a1e6] text-[#8a8fad] hover:text-[#b3a1e6]
                         font-medium px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {applyingRules ? 'Applying…' : '★ Rules'}
            </button>
            {connection ? (
              <button
                onClick={handleSync}
                disabled={syncing}
                title={syncResult ?? (connection.lastSyncedAt
                  ? `Last synced ${new Date(connection.lastSyncedAt).toLocaleString()}`
                  : 'Never synced')}
                className="border border-[#3a3b58] hover:border-[#5ccc96] text-[#8a8fad] hover:text-[#5ccc96]
                           font-medium px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : '↻ Sync'}
              </button>
            ) : (
              <PlaidLink accountId={account.id} onConnected={() => router.refresh()} />
            )}
            <button
              onClick={() => setShowImport(true)}
              className="border border-[#3a3b58] hover:border-[#b3a1e6] text-[#8a8fad] hover:text-[#ecf0f1]
                         font-medium px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              <span className="sm:hidden">CSV</span>
              <span className="hidden sm:inline">Import CSV</span>
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold px-3 sm:px-4 py-1.5 rounded-lg text-sm transition-colors"
            >
              <span className="sm:hidden">+ Add</span>
              <span className="hidden sm:inline">+ Add Transaction</span>
            </button>
          </div>
          {syncResult && (
            <span className="text-[10px] text-[#8a8fad]">{syncResult}</span>
          )}
        </div>
      </div>

      {/* Column headers — desktop only */}
      <div className="flex-shrink-0 hidden sm:grid grid-cols-[2rem_7rem_1fr_1fr_7rem_5rem] gap-2 px-4 py-2
                      bg-[#1a1b2e] border-b border-[#3a3b58]
                      text-xs font-semibold text-[#8a8fad] uppercase tracking-wider">
        <span title="Cleared" className="text-center">○</span>
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
          <TransactionRow
            key={txn.id}
            txn={txn}
            allAccounts={allAccounts}
            allCategories={allCategories}
            onDelete={handleDelete}
            onEdit={() => setEditingTxn(txn)}
          />
        ))}
      </div>

      {showModal && (
        <AddTransactionModal
          accounts={allAccounts}
          categories={allCategories}
          defaultAccountId={account.id}
          onClose={() => {
            setShowModal(false)
            router.refresh()
          }}
        />
      )}

      {editingTxn && (
        <AddTransactionModal
          accounts={allAccounts}
          categories={allCategories}
          initialValues={{
            id: editingTxn.id,
            accountId: editingTxn.accountId,
            categoryId: editingTxn.categoryId,
            date: editingTxn.date,
            payee: editingTxn.payee,
            amount: editingTxn.amount,
            memo: editingTxn.memo,
          }}
          onClose={() => {
            setEditingTxn(null)
            router.refresh()
          }}
        />
      )}

      {showImport && (
        <CsvImportModal
          accountId={account.id}
          categories={allCategories}
          onClose={() => {
            setShowImport(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
