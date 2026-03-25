'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AddAccountModal } from '@/components/AddAccountModal'
import { closeAccount, deleteAccount } from '@/lib/actions'
import { formatMoney } from '@/lib/budget'
import { useAdminMode } from '@/lib/admin-mode'

interface Account {
  id: string
  name: string
  type: string
  balance: number
  closed: boolean
  requiresRelink?: boolean
}

// ── Grouping constants (mirrors sidebar) ────────────────────────────────────────
const LIABILITY_TYPES  = new Set(['credit_card', 'loan'])
const INVESTMENT_TYPES = new Set(['investment'])
const PROPERTY_TYPES   = new Set(['real_estate', 'vehicle', 'other'])

const TYPE_ICONS: Record<string, string> = {
  checking:    '🏦',
  savings:     '💵',
  credit_card: '💳',
  cash:        '💸',
  loan:        '🏠',
  real_estate: '🏠',
  vehicle:     '🚗',
  investment:  '📈',
  other:       '📁',
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

// ── Account row ─────────────────────────────────────────────────────────────
function AccountRow({
  account, isClosed = false, onClose, onDelete, error,
}: {
  account: Account
  isClosed?: boolean
  onClose: (id: string) => void
  onDelete: (id: string, name: string) => void
  error?: string
}) {
  return (
    <div className={`flex items-center justify-between rounded-lg px-4 py-2.5 group transition-all
                     ${isClosed
                       ? 'bg-[#1a1b2e] border border-[#2a2b45] opacity-60 hover:opacity-80'
                       : account.requiresRelink
                         ? 'bg-[#1f2039] border border-[#e39400]/40 hover:border-[#e39400] hover:bg-[#252640]'
                         : 'bg-[#1f2039] border border-[#2a2b45] hover:border-[#3a3b58] hover:bg-[#252640]'}`}>
      <Link href={`/accounts/${account.id}`} className="flex items-center gap-2.5 flex-1 min-w-0">
        <span className="text-base leading-none flex-shrink-0">{TYPE_ICONS[account.type] ?? '📁'}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#ecf0f1] truncate">{account.name}</p>
          <p className="text-[11px] text-[#5a5b78] mt-0.5">
            {TYPE_LABELS[account.type] ?? account.type}
            {isClosed && ' · Closed'}
            {account.requiresRelink && !isClosed && (
              <span className="ml-2 text-[#e39400] font-medium">⚠️ Bank connection needs attention</span>
            )}
            {error && <span className="ml-2 text-[#ce6f8f]">{error}</span>}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-3 flex-shrink-0">
        <p className={`text-sm font-semibold tabular-nums ${
          account.balance < 0 ? 'text-[#ce6f8f]' : isClosed ? 'text-[#8a8fad]' : 'text-[#5ccc96]'
        }`}>
          {formatMoney(account.balance)}
        </p>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onClose(account.id)}
            className="text-xs text-[#5a5b78] hover:text-[#f2ce00] px-1.5 py-0.5 rounded hover:bg-[#f2ce00]/10 transition-colors"
          >
            {isClosed ? 'Reopen' : 'Close'}
          </button>
          <button
            onClick={() => onDelete(account.id, account.name)}
            className="text-xs text-[#5a5b78] hover:text-[#ce6f8f] px-1.5 py-0.5 rounded hover:bg-[#ce6f8f]/10 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Section block ─────────────────────────────────────────────────────────
function Section({
  label, total, color, accounts, onClose, onDelete, errors,
}: {
  label: string
  total: number
  color: string
  accounts: Account[]
  onClose: (id: string) => void
  onDelete: (id: string, name: string) => void
  errors: Record<string, string>
}) {
  if (accounts.length === 0) return null
  return (
    <div>
      <div className="flex items-center justify-between px-1 mb-1.5">
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${color}`}>{label}</span>
        <span className={`text-[10px] tabular-nums ${color}`}>{formatMoney(total)}</span>
      </div>
      <div className="space-y-1">
        {accounts.map((a) => (
          <AccountRow key={a.id} account={a} onClose={onClose} onDelete={onDelete} error={errors[a.id]} />
        ))}
      </div>
    </div>
  )
}

export default function AccountsPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)
  const [cleanupMsg, setCleanupMsg] = useState('')
  const [, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({}) 
  const [adminMode] = useAdminMode()

  async function loadAccounts() {
    const res = await fetch('/api/accounts')
    if (res.ok) setAccounts(await res.json())
    setLoading(false)
  }
  useEffect(() => {
    fetch('/api/accounts')
      .then(async (res) => {
        if (res.ok) setAccounts(await res.json())
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function handleClose(id: string) {
    startTransition(async () => { await closeAccount(id); router.refresh(); loadAccounts() })
  }

  async function handleCleanupOrphans() {
    setCleaningUp(true)
    setCleanupMsg('')
    const res = await fetch('/api/plaid/cleanup-orphans', { method: 'POST' })
    const data = await res.json()
    setCleaningUp(false)
    if (res.ok) {
      setCleanupMsg(data.message ?? 'Done')
      loadAccounts()
      router.refresh()
    } else {
      setCleanupMsg(data.error ?? 'Failed')
    }
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}" and all its transactions? This cannot be undone.`)) return
    startTransition(async () => {
      try {
        await deleteAccount(id); router.refresh(); loadAccounts()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Cannot delete'
        setErrors((p) => ({ ...p, [id]: msg }))
        setTimeout(() => setErrors((p) => ({ ...p, [id]: '' })), 3000)
      }
    })
  }

  const active     = accounts.filter((a) => !a.closed)
  const closed     = accounts.filter((a) => a.closed)
  const cash       = active.filter((a) => !LIABILITY_TYPES.has(a.type) && !INVESTMENT_TYPES.has(a.type) && !PROPERTY_TYPES.has(a.type))
  const investments = active.filter((a) => INVESTMENT_TYPES.has(a.type))
  const property   = active.filter((a) => PROPERTY_TYPES.has(a.type))
  const liabilities = active.filter((a) => LIABILITY_TYPES.has(a.type))
  const cashTotal       = cash.reduce((s, a) => s + a.balance, 0)
  const investmentTotal = investments.reduce((s, a) => s + a.balance, 0)
  const propertyTotal   = property.reduce((s, a) => s + a.balance, 0)
  const liabilityTotal  = liabilities.reduce((s, a) => s + a.balance, 0)
  const netWorth = cashTotal + investmentTotal + propertyTotal + liabilityTotal

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-[#1f2039] border-b border-[#3a3b58] px-6 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#ecf0f1]">Accounts</h2>
          {!loading && active.length > 0 && (
            <p className="text-xs text-[#8a8fad] mt-0.5">
              Net Worth:{' '}
              <span className={netWorth >= 0 ? 'text-[#5ccc96]' : 'text-[#ce6f8f]'}>{formatMoney(netWorth)}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {cleanupMsg && <span className="text-xs text-[#8a8fad]">{cleanupMsg}</span>}
          {adminMode && (
            <button
              onClick={handleCleanupOrphans}
              disabled={cleaningUp}
              title="Delete empty accounts with no bank connection (orphaned duplicates from reconnect issues)"
              className="border border-[#ce6f8f]/50 hover:border-[#ce6f8f] text-[#ce6f8f]/70 hover:text-[#ce6f8f] font-medium px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {cleaningUp ? 'Cleaning…' : '⚠ Clean up orphans'}
            </button>
          )}
          <button
            onClick={() => setShowModal(true)}
            className="bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold px-4 py-1.5 rounded-lg text-sm transition-colors"
          >
            + Add Account
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        {loading && <p className="text-[#8a8fad] text-sm">Loading…</p>}

        {!loading && accounts.length === 0 && (
          <div className="text-center py-12 text-[#8a8fad]">
            <p className="text-lg mb-2">No accounts yet</p>
            <p className="text-sm">Add your first account to get started.</p>
          </div>
        )}

        {!loading && accounts.length > 0 && (
          <div className="space-y-6 max-w-2xl">
            <Section label="Cash & Bank"  total={cashTotal}       color="text-[#5ccc96]" accounts={cash}        onClose={handleClose} onDelete={handleDelete} errors={errors} />
            <Section label="Investments"  total={investmentTotal} color="text-[#f2ce00]" accounts={investments} onClose={handleClose} onDelete={handleDelete} errors={errors} />
            <Section label="Property"     total={propertyTotal}   color="text-[#00a3cc]" accounts={property}    onClose={handleClose} onDelete={handleDelete} errors={errors} />
            <Section label="Liabilities"  total={liabilityTotal}  color="text-[#ce6f8f]" accounts={liabilities} onClose={handleClose} onDelete={handleDelete} errors={errors} />

            {active.length > 0 && (
              <div className="flex items-center justify-between pt-3 border-t border-[#3a3b58] px-1">
                <span className="text-xs text-[#8a8fad] uppercase tracking-wide">Net Worth</span>
                <span className={`text-sm font-semibold tabular-nums ${netWorth < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'}`}>
                  {formatMoney(netWorth)}
                </span>
              </div>
            )}

            {closed.length > 0 && (
              <div>
                <button
                  onClick={() => setShowClosed((v) => !v)}
                  className="text-xs text-[#5a5b78] hover:text-[#8a8fad] transition-colors mb-2"
                >
                  {showClosed ? '▾' : '▸'} {closed.length} closed account{closed.length !== 1 ? 's' : ''}
                </button>
                {showClosed && (
                  <div className="space-y-1">
                    {closed.map((a) => (
                      <AccountRow key={a.id} account={a} isClosed onClose={handleClose} onDelete={handleDelete} error={errors[a.id]} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <AddAccountModal onClose={() => { setShowModal(false); loadAccounts() }} />
      )}
    </div>
  )
}
