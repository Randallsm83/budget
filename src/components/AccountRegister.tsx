'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AddTransactionModal } from './AddTransactionModal'
import { CsvImportModal } from './CsvImportModal'
import { PlaidLink } from './PlaidLink'
import { PlaidRelink } from './PlaidRelink'
import { applyPayeeRules, deleteTransaction, recategorizePayee, toggleCleared, updateAccount, updateTransactionCategory } from '@/lib/actions'
import { UpdateBalanceModal } from './UpdateBalanceModal'
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
  allCategories: { id: string; name: string; groupName: string; isIncome: boolean; isCCPayment: boolean }[]
  connection: { id: string; lastSyncedAt: string | null } | null
}

const TYPE_LABELS: Record<string, string> = {
  checking:    'Checking',
  savings:     'Savings',
  credit_card: 'Credit Card',
  cash:        'Cash',
  loan:        'Loan',
  real_estate: 'Real Estate',
  vehicle:     'Vehicle',
  investment:  'Investment',
  other:       'Other',
}

// Tracking (off-budget) account types — no categories, no Plaid sync, no CSV
const TRACKING_TYPES = new Set(['investment', 'real_estate', 'vehicle', 'loan', 'other'])

function TransactionRow({
  txn,
  allCategories,
  isTracking,
  onDelete,
  onEdit,
  onCategoryChanged,
}: {
  txn: Transaction
  allCategories: { id: string; name: string; groupName: string; isIncome: boolean; isCCPayment: boolean }[]
  isTracking: boolean
  onDelete: (id: string) => void
  onEdit: () => void
  onCategoryChanged?: (payee: string, catId: string | null, catName: string | null) => void
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
    const catName = catId ? (allCategories.find((c) => c.id === catId)?.name ?? null) : null
    setLocalCatId(catId)
    setEditingCat(false)
    if (txn.payee && catId) onCategoryChanged?.(txn.payee, catId, catName)
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
      {allCategories.some((c) => !c.isIncome && !c.isCCPayment) && (
        <optgroup label="Expenses">
          {allCategories.filter((c) => !c.isIncome && !c.isCCPayment).map((c) => (
            <option key={c.id} value={c.id}>{c.groupName}: {c.name}</option>
          ))}
        </optgroup>
      )}
      {allCategories.some((c) => c.isCCPayment) && (
        <optgroup label="💳 Credit Card Payments">
          {allCategories.filter((c) => c.isCCPayment).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
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
          {/* Row 2: date · (category if budgeted) + actions */}
          <div className="flex items-center justify-between mt-1 gap-2">
            <div className="flex items-center gap-1 min-w-0 text-xs text-[#8a8fad] flex-1">
              <span className="flex-shrink-0 tabular-nums">{txn.date}</span>
              {!isTracking && (
                <>
                  <span className="flex-shrink-0">·</span>
                  <span className="truncate min-w-0">
                    {editingCat ? categorySelect : categoryButton}
                  </span>
                </>
              )}
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
      <div className={`hidden sm:grid gap-2 px-4 py-2.5 items-center ${
        isTracking
          ? 'grid-cols-[2rem_7rem_1fr_7rem_5rem]'
          : 'grid-cols-[2rem_7rem_1fr_1fr_7rem_5rem]'
      }`}>
        {clearedDot}
        <span className="text-xs text-[#8a8fad] tabular-nums">{txn.date}</span>
        <div className="min-w-0">
          <p className="text-sm text-[#ecf0f1] truncate">{txn.payee || '—'}</p>
          {txn.memo && <p className="text-xs text-[#8a8fad] truncate">{txn.memo}</p>}
        </div>
        {!isTracking && (
          <span className="text-xs truncate">
            {editingCat ? categorySelect : categoryButton}
          </span>
        )}
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
  const isTracking = TRACKING_TYPES.has(account.type)
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null)
  const [txns, setTxns] = useState(transactions)
  const [renamingAccount, setRenamingAccount] = useState(false)
  const [accountName, setAccountName] = useState(account.name)
  const [showUpdateBalance, setShowUpdateBalance] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [applyingRules, setApplyingRules] = useState(false)
  const [relinkRequired, setRelinkRequired] = useState(false)
  const [pendingRecat, setPendingRecat] = useState<{ payee: string; catId: string | null; catName: string | null } | null>(null)
  const [recatPending, setRecatPending] = useState(false)
  const [, startTransition] = useTransition()

  async function handleApplyRules() {
    setApplyingRules(true)
    setSyncResult(null)
    try {
      const result = await applyPayeeRules()
      let msg: string
      if (result.rules === 0) {
        msg = 'No rules yet — categorize some transactions first'
      } else if (result.scanned === 0) {
        msg = `All transactions already categorized (${result.rules} rule${result.rules !== 1 ? 's' : ''} ready)`
      } else {
        msg = `${result.updated} of ${result.scanned} uncategorized matched (${result.rules} rules)`
      }
      setSyncResult(msg)
      router.refresh()
    } catch (err) {
      console.error('applyPayeeRules error:', err)
      setSyncResult('Error applying rules — check console')
    } finally {
      setApplyingRules(false)
    }
  }

  async function handleLoadHistory() {
    setLoadingHistory(true)
    setSyncResult(null)
    const res = await fetch('/api/plaid/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: account.id }),
    })
    if (!res.ok) {
      const data = await res.json()
      setSyncResult(`History refresh failed: ${data.error ?? 'unknown error'}`)
      setLoadingHistory(false)
      return
    }
    // Plaid loads history async — sync now to pick up whatever's ready,
    // then auto-retry in 60s for the rest
    setLoadingHistory(false)
    setSyncResult('History refresh requested — syncing…')
    const syncRes = await fetch('/api/plaid/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: account.id }),
    })
    const syncData = await syncRes.json()
    if (syncRes.ok) {
      setSyncResult(`+${syncData.added} added — more history may arrive in a few minutes, sync again to pick it up`)
      router.refresh()
    } else {
      setSyncResult(`Sync after refresh failed: ${syncData.error ?? 'unknown'}`)
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
    if (data.requiresRelink) {
      setRelinkRequired(true)
      setSyncResult('Bank connection expired — click Re-link Bank to reconnect')
      return
    }
    if (res.ok) {
      setRelinkRequired(false)
      let msg = `+${data.added} added, ${data.modified} updated, ${data.removed} removed`
      if (data.firstSync) {
        msg += ' · Loading history — auto-syncing in 30s'
        setTimeout(handleSync, 30_000)
      }
      setSyncResult(msg)
      router.refresh()
    } else {
      setSyncResult(`Sync failed: ${data.error ?? 'unknown error'}`)
    }
  }

  async function handleRecategorizeAll() {
    if (!pendingRecat) return
    setRecatPending(true)
    try {
      const result = await recategorizePayee(pendingRecat.payee, pendingRecat.catId)
      setSyncResult(`${result.updated} transaction${result.updated !== 1 ? 's' : ''} updated for "${pendingRecat.payee}"`)
      router.refresh()
    } catch (err) {
      console.error('recategorizePayee error:', err)
      setSyncResult('Error applying to all — check console')
    } finally {
      setRecatPending(false)
      setPendingRecat(null)
    }
  }

  function commitRename(name: string) {
    setRenamingAccount(false)
    if (name.trim() && name.trim() !== account.name) {
      setAccountName(name.trim())
      startTransition(async () => {
        await updateAccount(account.id, { name: name.trim(), type: account.type })
        router.refresh()
      })
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
    <div className="flex flex-col h-full overflow-x-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-[#1f2039] border-b border-[#3a3b58] px-4 sm:px-6 py-3
                      flex flex-wrap sm:flex-nowrap items-start sm:items-center justify-between gap-2
                      overflow-x-hidden">
        <div className="min-w-0 flex-1">
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
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold text-[#ecf0f1]">{accountName}</h2>
              <button
                onClick={() => setRenamingAccount(true)}
                title="Rename account"
                className="text-xs text-[#5a5b78] hover:text-[#b3a1e6] transition-colors px-0.5"
              >✎</button>
            </div>
          )}
          <p className="text-xs text-[#8a8fad] mt-0.5 truncate">
            {TYPE_LABELS[account.type] ?? account.type}
            {isTracking ? ' · Current Value: ' : ' · Balance: '}
            <span className={account.balance < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'}>
              {formatMoney(account.balance)}
            </span>
            {!isTracking && (
              <>
                {' · Cleared: '}
                <span className={account.clearedBalance < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'}>
                  {formatMoney(account.clearedBalance)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 min-w-0 flex-shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
            {!isTracking && (
              <button
                onClick={handleApplyRules}
                disabled={applyingRules}
                title="Re-categorize uncategorized transactions using saved payee rules"
                className="border border-[#3a3b58] hover:border-[#b3a1e6] text-[#8a8fad] hover:text-[#b3a1e6]
                           font-medium px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {applyingRules ? 'Applying…' : '★ Rules'}
              </button>
            )}
            {!isTracking && connection && (
              <button
                onClick={handleLoadHistory}
                disabled={loadingHistory || syncing}
                title="Ask Plaid to load up to 24 months of transaction history"
                className="border border-[#3a3b58] hover:border-[#b3a1e6] text-[#8a8fad] hover:text-[#b3a1e6]
                           font-medium px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                <span className="sm:hidden">{loadingHistory ? '⏳' : '📜'}</span>
                <span className="hidden sm:inline">{loadingHistory ? 'Loading…' : 'Load History'}</span>
              </button>
            )}
            {!isTracking && (
              relinkRequired ? (
                <PlaidRelink
                  accountId={account.id}
                  onRelinkComplete={() => { setRelinkRequired(false); handleSync() }}
                />
              ) : connection ? (
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
              )
            )}
            {!isTracking && (
              <button
                onClick={() => setShowImport(true)}
                className="border border-[#3a3b58] hover:border-[#b3a1e6] text-[#8a8fad] hover:text-[#ecf0f1]
                           font-medium px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors"
              >
                <span className="sm:hidden">CSV</span>
                <span className="hidden sm:inline">Import CSV</span>
              </button>
            )}
            <button
              onClick={() => isTracking ? setShowUpdateBalance(true) : setShowModal(true)}
              className="bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold px-3 sm:px-4 py-1.5 rounded-lg text-sm transition-colors"
            >
              {isTracking ? (
                <><span className="sm:hidden">+ Value</span><span className="hidden sm:inline">+ Update Value</span></>
              ) : (
                <><span className="sm:hidden">+ Add</span><span className="hidden sm:inline">+ Add Transaction</span></>
              )}
            </button>
          </div>
          {syncResult && (
            <span className="text-[10px] text-[#8a8fad] text-right block max-w-[16rem] sm:max-w-xs break-words">{syncResult}</span>
          )}
        </div>
      </div>

      {/* Apply-to-all banner */}
      {pendingRecat && (
        <div className="flex-shrink-0 bg-[#2a2b45] border-b border-[#b3a1e6] px-4 py-2
                        flex items-center justify-between gap-4">
          <span className="text-xs text-[#ecf0f1] truncate">
            Apply{' '}
            <strong className="text-[#b3a1e6]">{pendingRecat.catName ?? 'Inflow'}</strong>
            {' '}to all{' '}
            <strong className="text-[#ecf0f1]">{pendingRecat.payee}</strong>
            {' '}transactions?
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleRecategorizeAll}
              disabled={recatPending}
              className="text-xs bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold
                         px-2.5 py-1 rounded transition-colors disabled:opacity-50"
            >
              {recatPending ? 'Applying…' : 'Apply to all'}
            </button>
            <button
              onClick={() => setPendingRecat(null)}
              className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] px-1"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Column headers — desktop only */}
      <div className={`flex-shrink-0 hidden sm:grid gap-2 px-4 py-2
                      bg-[#1a1b2e] border-b border-[#3a3b58]
                      text-xs font-semibold text-[#8a8fad] uppercase tracking-wider ${
        isTracking
          ? 'grid-cols-[2rem_7rem_1fr_7rem_5rem]'
          : 'grid-cols-[2rem_7rem_1fr_1fr_7rem_5rem]'
      }`}>
        <span title="Cleared" className="text-center">○</span>
        <span>Date</span>
        <span>{isTracking ? 'Note' : 'Payee / Memo'}</span>
        {!isTracking && <span>Category</span>}
        <span className="text-right">Amount</span>
        <span />
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-auto">
        {txns.length === 0 && (
          <div className="text-center py-12 text-[#8a8fad] text-sm">
            {isTracking
              ? 'No value updates yet. Click \u201c+ Update Value\u201d to record the current market value.'
              : 'No transactions yet. Add one to get started.'}
          </div>
        )}
        {txns.map((txn) => (
          <TransactionRow
            key={txn.id}
            txn={txn}
            allCategories={allCategories}
          isTracking={isTracking}
            onDelete={handleDelete}
            onEdit={() => setEditingTxn(txn)}
            onCategoryChanged={(payee, catId, catName) => {
              if (payee && catId) setPendingRecat({ payee, catId, catName })
            }}
          />
        ))}
      </div>

      {showUpdateBalance && (
        <UpdateBalanceModal
          accountId={account.id}
          accountType={account.type}
          currentBalance={account.balance}
          onClose={() => setShowUpdateBalance(false)}
        />
      )}

      {showModal && (
        <AddTransactionModal
          accounts={allAccounts}
          categories={allCategories}
          defaultAccountId={account.id}
          isTracking={isTracking}
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
          isTracking={isTracking}
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
