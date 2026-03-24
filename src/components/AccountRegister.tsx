'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AddTransactionModal } from './AddTransactionModal'
import { CsvImportModal } from './CsvImportModal'
import { PlaidLink } from './PlaidLink'
import { PlaidRelink } from './PlaidRelink'
import { PlaidNewAccounts } from './PlaidNewAccounts'
import { applyPayeeRules, clearRelinkRequired, clearNewAccountsAvailable, disconnectPlaidConnection, deleteTransaction, recategorizePayee, toggleCleared, toggleTransfer, updateAccount, updateTransactionCategory } from '@/lib/actions'
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
  isTransfer: boolean
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

interface InvestmentHolding {
  id: string
  plaidSecurityId: string
  name: string
  tickerSymbol: string | null
  securityType: string | null
  quantity: number
  institutionPrice: number
  institutionValue: number
  costBasis: number | null
  isoCurrencyCode: string | null
  updatedAt: string
}

interface LiabilityDetail {
  id: string
  liabilityType: string
  details: Record<string, unknown>
  syncedAt: string
}

interface Props {
  account: Account
  transactions: Transaction[]
  allAccounts: { id: string; name: string }[]
  allCategories: { id: string; name: string; groupName: string; isIncome: boolean; isCCPayment: boolean }[]
  connection: { id: string; lastSyncedAt: string | null; requiresRelink: boolean; newAccountsAvailable: boolean } | null
  holdings?: InvestmentHolding[]
  liabilityDetails?: LiabilityDetail | null
}

function HoldingsPanel({
  holdings,
  accountId,
  connection,
  onSynced,
}: {
  holdings: InvestmentHolding[]
  accountId: string
  connection: { id: string; lastSyncedAt: string | null } | null
  onSynced: (msg: string) => void
}) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    const res = await fetch('/api/plaid/investments/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    })
    const data = await res.json()
    setSyncing(false)
    if (res.ok) {
      onSynced(`Synced ${data.synced} holding${data.synced !== 1 ? 's' : ''}`)
      router.refresh()
    } else {
      onSynced(`Holdings sync failed: ${data.error ?? 'unknown error'}`)
    }
  }

  if (!connection && holdings.length === 0) return null

  return (
    <div className="flex-shrink-0 border-b border-[#3a3b58] bg-[#1a1b2e]">
      <div className="px-4 sm:px-6 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-[#8a8fad] uppercase tracking-wider">Holdings</span>
        {connection && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="border border-[#3a3b58] hover:border-[#5ccc96] text-[#8a8fad] hover:text-[#5ccc96]
                       text-xs px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : '↻ Sync Holdings'}
          </button>
        )}
      </div>
      {holdings.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#8a8fad] uppercase tracking-wider border-b border-[#3a3b58]">
                <th className="px-4 sm:px-6 py-1.5 text-left font-semibold">Ticker</th>
                <th className="px-2 py-1.5 text-left font-semibold hidden sm:table-cell">Name</th>
                <th className="px-2 py-1.5 text-right font-semibold">Shares</th>
                <th className="px-2 py-1.5 text-right font-semibold">Price</th>
                <th className="px-2 py-1.5 text-right font-semibold">Value</th>
                <th className="px-2 py-1.5 text-right font-semibold hidden sm:table-cell">Cost Basis</th>
                <th className="px-4 sm:px-6 py-1.5 text-right font-semibold hidden sm:table-cell">Gain / Loss</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const gain = h.costBasis !== null ? h.institutionValue - h.costBasis : null
                const gainPct = h.costBasis ? ((gain! / h.costBasis) * 100).toFixed(1) : null
                const currency = h.isoCurrencyCode ?? 'USD'
                const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 })
                return (
                  <tr key={h.id} className="border-b border-[#1f2039] hover:bg-[#1f2039] transition-colors">
                    <td className="px-4 sm:px-6 py-2 font-mono text-[#b3a1e6]">{h.tickerSymbol ?? '—'}</td>
                    <td className="px-2 py-2 text-[#ecf0f1] truncate max-w-[12rem] hidden sm:table-cell">{h.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-[#ecf0f1]">{h.quantity.toFixed(4)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-[#ecf0f1]">{fmt.format(h.institutionPrice)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium text-[#5ccc96]">{fmt.format(h.institutionValue)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-[#8a8fad] hidden sm:table-cell">
                      {h.costBasis !== null ? fmt.format(h.costBasis) : '—'}
                    </td>
                    <td className={`px-4 sm:px-6 py-2 text-right tabular-nums hidden sm:table-cell ${
                      gain === null ? 'text-[#8a8fad]' : gain >= 0 ? 'text-[#5ccc96]' : 'text-[#ce6f8f]'
                    }`}>
                      {gain !== null
                        ? `${gain >= 0 ? '+' : ''}${fmt.format(gain)}${gainPct ? ` (${gain >= 0 ? '+' : ''}${gainPct}%)` : ''}`
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 sm:px-6 pb-3 text-xs text-[#8a8fad]">
          No holdings data yet.{connection ? ' Click \u201c\u21bb Sync Holdings\u201d to load.' : ''}
        </p>
      )}
    </div>
  )
}

function LiabilityPanel({
  liability,
  accountId,
  connection,
  onSynced,
}: {
  liability: LiabilityDetail | null | undefined
  accountId: string
  connection: { id: string; lastSyncedAt: string | null } | null
  onSynced: (msg: string) => void
}) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    const res = await fetch('/api/plaid/liabilities/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    })
    const data = await res.json()
    setSyncing(false)
    if (res.ok && data.synced) {
      onSynced('Liability details synced')
      router.refresh()
    } else if (res.ok) {
      onSynced('No liability data found for this account')
    } else {
      onSynced(`Details sync failed: ${data.error ?? 'unknown error'}`)
    }
  }

  if (!connection && !liability) return null

  const d = liability?.details
  const type = liability?.liabilityType

  const fmtAmt = (v: unknown): string | null =>
    typeof v === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v) : null

  let fields: { label: string; value: string | null }[] = []
  if (type === 'credit' && d) {
    const cd = d as Record<string, unknown>
    const aprs = cd.aprs as { apr_percentage: number; apr_type: string }[] | undefined
    const purchaseApr = aprs?.find((a) => a.apr_type === 'purchase_apr')
    fields = [
      { label: 'Purchase APR', value: purchaseApr ? `${purchaseApr.apr_percentage}%` : null },
      { label: 'Min Payment', value: fmtAmt(cd.minimum_payment_amount) },
      { label: 'Next Due', value: typeof cd.next_payment_due_date === 'string' ? cd.next_payment_due_date : null },
      { label: 'Last Statement', value: fmtAmt(cd.last_statement_balance) },
    ]
  } else if (type === 'student' && d) {
    const sd = d as Record<string, unknown>
    const plan = sd.repayment_plan as { type?: string } | undefined
    fields = [
      { label: 'Interest Rate', value: typeof sd.interest_rate_percentage === 'number' ? `${sd.interest_rate_percentage}%` : null },
      { label: 'Min Payment', value: fmtAmt(sd.minimum_payment_amount) },
      { label: 'Next Due', value: typeof sd.next_payment_due_date === 'string' ? sd.next_payment_due_date : null },
      { label: 'Payoff Date', value: typeof sd.expected_payoff_date === 'string' ? sd.expected_payoff_date : null },
      { label: 'Repayment Plan', value: plan?.type ?? null },
    ]
  } else if (type === 'mortgage' && d) {
    const md = d as Record<string, unknown>
    const rate = md.interest_rate as { percentage?: number } | undefined
    const addr = md.property_address as { street?: string; city?: string; state?: string } | undefined
    fields = [
      { label: 'Interest Rate', value: typeof rate?.percentage === 'number' ? `${rate.percentage}%` : null },
      { label: 'Last Payment', value: fmtAmt(md.last_payment_amount) },
      { label: 'Maturity Date', value: typeof md.maturity_date === 'string' ? md.maturity_date : null },
      { label: 'Property', value: addr ? [addr.street, addr.city, addr.state].filter(Boolean).join(', ') : null },
    ]
  }

  const validFields = fields.filter((f) => f.value !== null)
  const panelLabel =
    type === 'credit' ? 'Credit Card Details'
    : type === 'student' ? 'Student Loan Details'
    : type === 'mortgage' ? 'Mortgage Details'
    : 'Liability Details'

  return (
    <div className="flex-shrink-0 border-b border-[#3a3b58] bg-[#1a1b2e]">
      <div className="px-4 sm:px-6 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-[#8a8fad] uppercase tracking-wider">{panelLabel}</span>
        {connection && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="border border-[#3a3b58] hover:border-[#5ccc96] text-[#8a8fad] hover:text-[#5ccc96]
                       text-xs px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : '↻ Sync Details'}
          </button>
        )}
      </div>
      {validFields.length > 0 ? (
        <div className="px-4 sm:px-6 pb-3 flex flex-wrap gap-x-6 gap-y-2">
          {validFields.map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] text-[#8a8fad] uppercase tracking-wider">{label}</p>
              <p className="text-sm text-[#ecf0f1] tabular-nums">{value}</p>
            </div>
          ))}
          {liability?.syncedAt && (
            <div className="w-full text-[10px] text-[#5a5b78] mt-1">
              Synced {new Date(liability.syncedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      ) : (
        <p className="px-4 sm:px-6 pb-3 text-xs text-[#8a8fad]">
          No liability details yet.{connection ? ' Click \u201c\u21bb Sync Details\u201d to load.' : ''}
        </p>
      )}
    </div>
  )
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

const TRANSFER_PAYEE_RE = /^(online transfer|transfer (from|to|between)|ach transfer|wire transfer|book transfer)/i

/** Display-only title-casing for ALL-CAPS bank payee strings. Stored value is unchanged. */
function displayPayee(payee: string): string {
  if (!payee) return payee
  if (payee === payee.toUpperCase() && /[A-Z]/.test(payee)) {
    return payee.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return payee
}

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
  const [localIsTransfer, setLocalIsTransfer] = useState(txn.isTransfer)

  const localCatName = localCatId
    ? (allCategories.find((c) => c.id === localCatId)?.name ?? null)
    : null

  function handleToggleTransfer() {
    const next = !localIsTransfer
    setLocalIsTransfer(next)
    if (next) { setLocalCatId(null); setEditingCat(false) }
    startTransition(async () => {
      await toggleTransfer(txn.id)
      router.refresh()
    })
  }

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

  const categoryButton = localIsTransfer ? (
    <span className="text-[#42b3c2] text-xs">↔ Transfer</span>
  ) : (
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

  const transferToggle = (
    <button
      onClick={handleToggleTransfer}
      title={localIsTransfer ? 'Unmark as transfer' : 'Mark as transfer (excludes from budget)'}
      aria-label={localIsTransfer ? 'Unmark as transfer' : 'Mark as transfer'}
      className={`text-xs px-1 py-1 transition-colors flex-shrink-0 ${
        localIsTransfer ? 'text-[#42b3c2] hover:text-[#8a8fad]' : 'text-[#3a3b58] hover:text-[#42b3c2]'
      }`}
    >
      ↔
    </button>
  )

  const clearedDot = (
    <button
      onClick={handleToggleCleared}
      title={txn.cleared ? 'Cleared — click to unclear' : 'Uncleared — click to clear'}
      aria-label={txn.cleared ? 'Mark as uncleared' : 'Mark as cleared'}
      className="flex items-center justify-center flex-shrink-0 p-1"
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
          <p className="text-sm text-[#ecf0f1] truncate">{displayPayee(txn.payee) || '—'}</p>
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
              {!isTracking && transferToggle}
              <button
                onClick={onEdit}
                className="text-xs text-[#8a8fad] hover:text-[#b3a1e6] px-1.5 py-1 rounded transition-colors"
                title="Edit"
                aria-label="Edit transaction"
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
          <p className="text-sm text-[#ecf0f1] truncate">{displayPayee(txn.payee) || '—'}</p>
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
          {!isTracking && (
            <span className="opacity-30 group-hover:opacity-100 transition-all">{transferToggle}</span>
          )}
          <button
            onClick={onEdit}
            className="text-xs text-[#3a3b58] hover:text-[#b3a1e6] opacity-30 group-hover:opacity-100 transition-all px-1"
            title="Edit"
            aria-label="Edit transaction"
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
              className="text-xs text-[#3a3b58] hover:text-[#ce6f8f] opacity-30 group-hover:opacity-100 transition-all"
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

export function AccountRegister({ account, transactions, allAccounts, allCategories, connection, holdings, liabilityDetails }: Props) {
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
  const [enriching, setEnriching] = useState(false)
  const [relinkRequired, setRelinkRequired] = useState(connection?.requiresRelink ?? false)
  const [newAccountsAvailable, setNewAccountsAvailable] = useState(connection?.newAccountsAvailable ?? false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [showSecondary, setShowSecondary] = useState(false)

  const uncategorizedCount = isTracking ? 0 : txns.filter(
    (t) => !t.categoryId && !t.isTransfer && t.amount < 0
  ).length
  const [pendingRecat, setPendingRecat] = useState<{ payee: string; catId: string | null; catName: string | null } | null>(null)
  const [recatPending, setRecatPending] = useState(false)
  const [, startTransition] = useTransition()

  async function handleEnrich() {
    setEnriching(true)
    setSyncResult(null)
    const res = await fetch('/api/plaid/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: account.id }),
    })
    const data = await res.json()
    setEnriching(false)
    if (res.ok) {
      const msg = data.enriched === 0
        ? 'No new merchant names found'
        : `${data.enriched} payee${data.enriched !== 1 ? 's' : ''} cleaned${data.categorized ? `, ${data.categorized} auto-categorized` : ''}`
      setSyncResult(msg)
      router.refresh()
    } else {
      setSyncResult(`Enrich failed: ${data.error ?? 'unknown error'}`)
    }
  }

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
    setLoadingHistory(false)
    if (!res.ok) {
      const data = await res.json()
      setSyncResult(`History request failed: ${data.error ?? 'unknown error'}`)
      return
    }
    // Plaid loads history asynchronously in the background.
    // The webhook (SYNC_UPDATES_AVAILABLE) will auto-sync transactions as they arrive.
    setSyncResult('History requested — transactions will appear automatically as Plaid loads them (usually a few minutes)')
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

  async function handleRepair() {
    if (!confirm('This will delete all bank-imported transactions for every account at this bank and re-sync from scratch. Manual transactions are kept. Continue?')) return
    setRepairing(true)
    setSyncResult(null)
    const res = await fetch('/api/plaid/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: account.id }),
    })
    const data = await res.json()
    setRepairing(false)
    if (res.ok) {
      setSyncResult(`Repaired: ${data.affectedAccounts ?? 1} accounts re-synced cleanly, ${data.restoredCategories ?? 0} categories restored`)
      router.refresh()
    } else {
      setSyncResult(`Repair failed: ${data.error ?? 'unknown error'}`)
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
            {/* Mobile overflow toggle */}
            {!isTracking && (
              <button
                onClick={() => setShowSecondary((p) => !p)}
                title="More actions"
                className="sm:hidden border border-[#3a3b58] hover:border-[#b3a1e6] text-[#8a8fad] hover:text-[#b3a1e6]
                           font-medium px-2.5 py-1.5 rounded-lg text-sm transition-colors"
              >
                {showSecondary ? '×' : '⋯'}
              </button>
            )}
            {!isTracking && connection && (
              <button
                className={`${showSecondary ? 'flex' : 'hidden'} sm:flex border border-[#ce6f8f]/60 hover:border-[#ce6f8f] text-[#ce6f8f]/70 hover:text-[#ce6f8f]
                           font-medium px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50`}
                onClick={handleRepair}
                disabled={repairing || syncing}
                title="Delete all bank-imported transactions for this bank and re-sync from scratch. Fixes crossed transactions between accounts."
              >
                {repairing ? 'Repairing…' : '⚠ Repair'}
              </button>
            )}
            {!isTracking && (
              <button
                className={`${showSecondary ? 'flex' : 'hidden'} sm:flex border border-[#3a3b58] hover:border-[#b3a1e6] text-[#8a8fad] hover:text-[#b3a1e6]
                           font-medium px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50`}
                onClick={handleEnrich}
                disabled={enriching}
                title="Clean up merchant names and auto-categorize using Plaid Enrich"
              >
                {enriching ? 'Cleaning up…' : '✨ Clean up'}
              </button>
            )}
            {!isTracking && (
              <button
                className={`${showSecondary ? 'flex' : 'hidden'} sm:flex border border-[#3a3b58] hover:border-[#b3a1e6] text-[#8a8fad] hover:text-[#b3a1e6]
                           font-medium px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50`}
                onClick={handleApplyRules}
                disabled={applyingRules}
                title="Re-categorize uncategorized transactions using saved payee rules"
              >
                {applyingRules ? 'Applying…' : '★ Rules'}
              </button>
            )}
            {!isTracking && connection && (
              <button
                onClick={handleLoadHistory}
                disabled={loadingHistory || syncing}
                title="Request up to 24 months of transaction history from Plaid. Transactions sync automatically via webhook — no need to click Sync."
                className={`${showSecondary ? 'flex' : 'hidden'} sm:flex border border-[#3a3b58] hover:border-[#b3a1e6] text-[#8a8fad] hover:text-[#b3a1e6]
                           font-medium px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50`}
              >
                <span className="sm:hidden">{loadingHistory ? '⏳' : '📜'}</span>
                <span className="hidden sm:inline">{loadingHistory ? 'Loading…' : 'Load History'}</span>
              </button>
            )}
            {!isTracking && connection && newAccountsAvailable && !relinkRequired && (
              <PlaidNewAccounts
                accountId={account.id}
                onComplete={() => { setNewAccountsAvailable(false); router.refresh() }}
              />
            )}
            {!isTracking && (
              relinkRequired ? (
                <PlaidRelink
                  accountId={account.id}
                  onRelinkComplete={async () => {
                    // Clear the DB flag immediately so all prompts dismiss even
                    // if the subsequent sync fails (Item is repaired at this point).
                    setRelinkRequired(false)
                    try { await clearRelinkRequired(account.id) } catch { /* non-critical */ }
                    router.refresh()
                    handleSync()
                  }}
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
            {/* PlaidLink for investment/loan tracking accounts without a connection */}
            {isTracking && !connection && (account.type === 'investment' || account.type === 'loan') && (
              <PlaidLink accountId={account.id} onConnected={() => router.refresh()} />
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
          {connection && (
            <button
              onClick={async () => {
if (!confirm('Disconnect this bank? Transactions are kept, but syncing will stop and your access token will be removed from Budget.'))
                  return
                setDisconnecting(true)
                try {
                  await disconnectPlaidConnection(account.id)
                  router.refresh()
                } catch {
                  setSyncResult('Disconnect failed — try again')
                } finally {
                  setDisconnecting(false)
                }
              }}
              disabled={disconnecting}
              className="text-[10px] text-[#5a5b78] hover:text-[#ce6f8f] transition-colors disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect bank'}
            </button>
          )}
        </div>
      </div>

      {/* Uncategorized transactions nudge */}
      {uncategorizedCount > 0 && (
        <div className="flex-shrink-0 bg-[#e39400]/10 border-b border-[#e39400]/30 px-4 sm:px-6 py-2 text-xs text-[#e39400]">
          <strong>{uncategorizedCount}</strong> uncategorized transaction{uncategorizedCount !== 1 ? 's' : ''} — click any category label to assign
        </div>
      )}

      {/* Holdings panel — investment accounts */}
      {account.type === 'investment' && (
        <HoldingsPanel
          holdings={holdings ?? []}
          accountId={account.id}
          connection={connection}
          onSynced={(msg) => setSyncResult(msg)}
        />
      )}

      {/* Liability details panel — loan / credit_card accounts */}
      {(account.type === 'loan' || account.type === 'credit_card') && (
        <LiabilityPanel
          liability={liabilityDetails}
          accountId={account.id}
          connection={connection}
          onSynced={(msg) => setSyncResult(msg)}
        />
      )}

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
