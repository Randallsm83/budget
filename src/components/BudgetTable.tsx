'use client'

import { useTransition, useState, useRef, useEffect } from 'react'
import { setBudgeted } from '@/lib/actions'
import { formatMoney, parseMoney, getBankBrand } from '@/lib/budget'
import Link from 'next/link'

export interface CategoryRow {
  id: string
  name: string
  budgeted: number // milliunits
  activity: number // milliunits
  balance: number // milliunits
  isCCPayment: boolean
  suggested?: number // milliunits — 3-month average spend; shown as a one-click suggestion
}

export interface GroupRow {
  id: string
  name: string
  isIncome: boolean
  isSystem: boolean
  isTransfer: boolean
  categories: CategoryRow[]
  totalBudgeted: number
  totalActivity: number
  totalBalance: number
}

// ---------------------------------------------------------------------------
// Inline editable budget amount cell
// ---------------------------------------------------------------------------
function EditableBudgeted({ categoryId, month, value, suggested, className = 'w-28' }: {
  categoryId: string; month: string; value: number; suggested?: number; className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [isPending, startTransition] = useTransition()
  const [savedFlash, setSavedFlash] = useState(false)
  const wasP = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  useEffect(() => {
    if (wasP.current && !isPending) {
      setSavedFlash(true)
      const t = setTimeout(() => setSavedFlash(false), 800)
      return () => clearTimeout(t)
    }
    wasP.current = isPending
  }, [isPending])

  function commit() {
    const amount = parseMoney(inputVal)
    setEditing(false)
    startTransition(() => setBudgeted(categoryId, month, amount))
  }

  function applySuggestion() {
    if (!suggested) return
    startTransition(() => setBudgeted(categoryId, month, suggested))
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        className={`${className} bg-[#2a2b45] border border-[#b3a1e6] text-right text-[#ecf0f1] text-sm rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#b3a1e6]`}
      />
    )
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={() => { setInputVal((value / 1000).toFixed(2)); setEditing(true) }}
        disabled={isPending}
        className={`${className} text-right text-sm text-[#ecf0f1] hover:text-[#b3a1e6] px-2 py-0.5 rounded hover:bg-[#2a2b45] transition-colors disabled:opacity-50 tabular-nums cursor-pointer${savedFlash ? ' ring-1 ring-[#5ccc96]' : ''}`}
      >
        {formatMoney(value)}
      </button>
      {value === 0 && suggested && suggested > 0 && (
        <button
          onClick={applySuggestion}
          disabled={isPending}
          title={`Apply 3-month average: ${formatMoney(suggested)}`}
          className="text-[10px] text-[#42b3c2] hover:text-[#5ccc96] tabular-nums px-1.5 py-px rounded border border-[#42b3c2]/30 hover:border-[#5ccc96]/50 bg-[#42b3c2]/5 hover:bg-[#5ccc96]/10 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          ~{formatMoney(suggested)} avg ↑
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Amount display with color
// ---------------------------------------------------------------------------
function Amount({ value, className = '' }: { value: number; className?: string }) {
  const color = value < 0 ? 'text-[#ce6f8f]' : value > 0 ? 'text-[#5ccc96]' : 'text-[#8a8fad]'
  return <span className={`tabular-nums ${color} ${className}`}>{formatMoney(value)}</span>
}

// ---------------------------------------------------------------------------
// Cover-to-zero quick action button
// ---------------------------------------------------------------------------
function CoverButton({ categoryId, month, budgeted, balance, rta, className = '' }: {
  categoryId: string; month: string; budgeted: number; balance: number; rta: number; className?: string
}) {
  const [isPending, startTransition] = useTransition()
  const newBudgeted = budgeted - balance
  const rtaAfter = rta + balance
  const warn = rtaAfter < 0

  return (
    <button
      onClick={() => startTransition(() => setBudgeted(categoryId, month, newBudgeted))}
      disabled={isPending}
      title={
        warn
          ? `RTA will go negative by ${formatMoney(-rtaAfter)}`
          : 'Budget just enough to bring this category to $0'
      }
      className={`text-[10px] font-semibold px-1.5 py-px rounded border transition-colors disabled:opacity-50 flex-shrink-0 ${
        warn
          ? 'bg-[#ce6f8f]/10 text-[#ce6f8f] border-[#ce6f8f]/30 hover:bg-[#ce6f8f]/20'
          : 'bg-[#e39400]/10 text-[#e39400] border-[#e39400]/30 hover:bg-[#e39400]/20'
      } ${className}`}
    >
      {isPending ? '…' : 'Cover'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Category item row — display only, no management actions
// ---------------------------------------------------------------------------
function CategoryItemRow({ cat, month, rta }: {
  cat: CategoryRow; month: string; rta: number
}) {
  const showCover = cat.balance < 0 && !cat.isCCPayment

  return (
    <>
      {/* ── Mobile card ── */}
      <div className="sm:hidden border-b border-[#1f2039] px-4 py-2">
        <span className="block text-sm text-[#ecf0f1] truncate mb-1">{cat.name}</span>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[10px] text-[#8a8fad] shrink-0">Assigned</span>
          <EditableBudgeted categoryId={cat.id} month={month} value={cat.budgeted} suggested={cat.suggested} className="w-20 text-right text-xs" />
          <span className="text-[#3a3b58] shrink-0">·</span>
          <span className="text-[10px] text-[#8a8fad] shrink-0">Spent</span>
          <Amount value={cat.activity} className="text-xs" />
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {showCover && <CoverButton categoryId={cat.id} month={month} budgeted={cat.budgeted} balance={cat.balance} rta={rta} />}
            <Amount value={cat.balance} className="text-xs font-semibold" />
          </div>
        </div>
      </div>

      {/* ── Desktop grid ── */}
      <div className="hidden sm:grid grid-cols-[1fr_7rem_7rem_7rem] px-6 py-1.5
                      border-b border-[#1f2039] hover:bg-[#1f2039] transition-colors items-center">
        <span className="text-sm text-[#ecf0f1] truncate">{cat.name}</span>
        <div className="flex justify-end pr-2">
          <EditableBudgeted categoryId={cat.id} month={month} value={cat.budgeted} suggested={cat.suggested} />
        </div>
        <Amount value={cat.activity} className="text-right text-sm pr-2" />
        <div className="flex items-center justify-end gap-1.5">
          {showCover && <CoverButton categoryId={cat.id} month={month} budgeted={cat.budgeted} balance={cat.balance} rta={rta} />}
          <Amount value={cat.balance} className="text-sm font-medium" />
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Group section — display-only header
// ---------------------------------------------------------------------------
function GroupSection({ group, month, rta }: {
  group: GroupRow; month: string; rta: number
}) {
  return (
    <div>
      {/* ── Mobile header ── */}
      <div className="sm:hidden flex items-center gap-2 px-4 py-2 bg-[#252640] border-b border-t border-[#3a3b58]">
        <span className="text-xs font-bold text-[#8a8fad] uppercase tracking-wider flex-1 truncate">{group.name}</span>
        <span className="text-[10px] text-[#8a8fad] tabular-nums">{formatMoney(group.totalBudgeted)}</span>
        <Amount value={group.totalBalance} className="text-xs" />
      </div>

      {/* ── Desktop header ── */}
      <div className="hidden sm:grid grid-cols-[1fr_7rem_7rem_7rem] px-6 py-2
                      bg-[#252640] border-b border-t border-[#3a3b58] items-center">
        <span className="text-xs font-bold text-[#8a8fad] uppercase tracking-wider">{group.name}</span>
        <span className="text-right text-xs text-[#8a8fad] tabular-nums pr-2">{formatMoney(group.totalBudgeted)}</span>
        <Amount value={group.totalActivity} className="text-right text-xs pr-2" />
        <Amount value={group.totalBalance} className="text-right text-xs font-semibold" />
      </div>

      {group.categories.map((cat) => (
        <CategoryItemRow key={cat.id} cat={cat} month={month} rta={rta} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mini bank card icon
// ---------------------------------------------------------------------------
function BankCard({ name }: { name: string }) {
  const { color, abbrev } = getBankBrand(name)
  return (
    <svg width="24" height="16" viewBox="0 0 24 16" fill="none" aria-hidden className="flex-shrink-0">
      <rect x="0.5" y="0.5" width="23" height="15" rx="2" fill={color} fillOpacity="0.15" stroke={color} strokeOpacity="0.7" />
      <rect x="0" y="3.5" width="24" height="2.5" fill={color} fillOpacity="0.4" />
      <text x="12" y="13" textAnchor="middle" fill={color} fontSize="5.5" fontWeight="700" fontFamily="monospace" opacity="0.9">{abbrev}</text>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// CC Payment section — read-only, system-managed
// ---------------------------------------------------------------------------
function CCPaymentSection({ groups }: { groups: GroupRow[] }) {
  if (groups.length === 0) return null
  return (
    <>
      <div className="hidden sm:grid grid-cols-[1fr_7rem_7rem_7rem] px-6 py-1.5
                      bg-[#1a1b2e] border-b border-[#3a3b58] text-[9px] font-bold text-[#42b3c2] uppercase tracking-widest">
        <span>💳 Credit Card Payments</span>
        <span className="text-right pr-2" title="CC spending this month — auto-set-aside for payment">Spent</span>
        <span className="text-right pr-2">Payments</span>
        <span className="text-right">Card Balance</span>
      </div>
      {groups.flatMap((g) =>
        g.categories.map((cat) => (
          <div key={cat.id}>
            <div className="sm:hidden flex items-center gap-2 px-4 py-2.5 border-b border-[#1f2039]">
              <BankCard name={cat.name} />
              <span className="text-sm text-[#ecf0f1] flex-1 truncate">{cat.name}</span>
              <Amount value={cat.balance} className="text-sm flex-shrink-0" />
            </div>
            <div className="hidden sm:grid grid-cols-[1fr_7rem_7rem_7rem] px-6 py-1.5 border-b border-[#1f2039] items-center">
              <div className="flex items-center gap-2">
                <BankCard name={cat.name} />
                <span className="text-sm text-[#ecf0f1] truncate" title="Auto-managed — funded by CC spending">{cat.name}</span>
              </div>
              <span className="text-right text-sm text-[#42b3c2] tabular-nums pr-2">{formatMoney(cat.budgeted)}</span>
              <Amount value={cat.activity} className="text-right text-sm pr-2" />
              <Amount value={cat.balance} className="text-right text-sm font-medium" />
            </div>
          </div>
        ))
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main table — budget-only, no management
// ---------------------------------------------------------------------------
export function BudgetTable({ month, groups, rta }: { month: string; groups: GroupRow[]; rta: number }) {
  const incomeGroups  = groups.filter((g) => g.isIncome && !g.isSystem && !g.isTransfer)
  const expenseGroups = groups.filter((g) => !g.isIncome && !g.isSystem && !g.isTransfer)
  const ccGroups      = groups.filter((g) => g.isSystem)

  function sectionLabel(label: string, color: string, cols: [string, string, string]) {
    return (
      <div className={`hidden sm:grid grid-cols-[1fr_7rem_7rem_7rem] px-6 py-1.5
                       bg-[#1a1b2e] border-b border-[#3a3b58] text-[9px] font-bold ${color} uppercase tracking-widest`}>
        <span>{label}</span>
        <span className="text-right pr-2">{cols[0]}</span>
        <span className="text-right pr-2">{cols[1]}</span>
        <span className="text-right">{cols[2]}</span>
      </div>
    )
  }

  return (
    <div className="flex-1 sm:overflow-x-auto">
      <div className="sm:min-w-[30rem]">
        {/* Income */}
        {incomeGroups.length > 0 && (
          <>
            {sectionLabel('💰 Income', 'text-[#5ccc96]', ['Expected', 'Received', 'vs Expected'])}
            {incomeGroups.map((g) => <GroupSection key={g.id} group={g} month={month} rta={rta} />)}
          </>
        )}

        {/* Expenses */}
        {expenseGroups.length === 0 && incomeGroups.length === 0 && (
          <div className="px-6 py-12 text-center text-[#8a8fad] text-sm">
            No categories yet.{' '}
            <Link href="/settings/categories" className="text-[#b3a1e6] hover:underline">
              Add groups and categories →
            </Link>
          </div>
        )}
        {expenseGroups.length > 0 && (
          <>
            {sectionLabel('💸 Expenses', 'text-[#8a8fad]', ['Assigned', 'Spent', 'Balance'])}
            {expenseGroups.map((g) => <GroupSection key={g.id} group={g} month={month} rta={rta} />)}
          </>
        )}

        <CCPaymentSection groups={ccGroups} />

        <div className="px-6 py-3 border-t border-[#3a3b58] mt-2">
          <Link
            href="/settings/categories"
            className="text-xs text-[#5a5b78] hover:text-[#b3a1e6] transition-colors"
          >
            ⚙ Manage groups &amp; categories
          </Link>
        </div>
      </div>
    </div>
  )
}
