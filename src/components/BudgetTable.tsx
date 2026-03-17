'use client'

import { useTransition, useState, useRef, useEffect } from 'react'
import { setBudgeted } from '@/lib/actions'
import { formatMoney, parseMoney } from '@/lib/budget'

export interface CategoryRow {
  id: string
  name: string
  budgeted: number // milliunits
  activity: number // milliunits
  balance: number // milliunits
}

export interface GroupRow {
  id: string
  name: string
  categories: CategoryRow[]
  totalBudgeted: number
  totalActivity: number
  totalBalance: number
}

// ---------------------------------------------------------------------------
// Inline editable cell for the "Budgeted" column
// ---------------------------------------------------------------------------
function EditableBudgeted({
  categoryId,
  month,
  value,
}: {
  categoryId: string
  month: string
  value: number
}) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function startEdit() {
    setInputVal((value / 1000).toFixed(2))
    setEditing(true)
  }

  function commit() {
    const amount = parseMoney(inputVal)
    setEditing(false)
    startTransition(() => setBudgeted(categoryId, month, amount))
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="w-28 bg-[#2a2b45] border border-[#b3a1e6] text-right text-[#ecf0f1] text-sm
                   rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#b3a1e6]"
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      disabled={isPending}
      className="w-28 text-right text-sm text-[#ecf0f1] hover:text-[#b3a1e6] px-2 py-0.5 rounded
                 hover:bg-[#2a2b45] transition-colors disabled:opacity-50 tabular-nums"
    >
      {formatMoney(value)}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Amount display with color
// ---------------------------------------------------------------------------
function Amount({ value, className = '' }: { value: number; className?: string }) {
  const color =
    value < 0 ? 'text-[#ce6f8f]' : value > 0 ? 'text-[#5ccc96]' : 'text-[#8a8fad]'
  return (
    <span className={`tabular-nums ${color} ${className}`}>{formatMoney(value)}</span>
  )
}

// ---------------------------------------------------------------------------
// Main table
// ---------------------------------------------------------------------------
export function BudgetTable({ month, groups }: { month: string; groups: GroupRow[] }) {
  return (
    <div className="flex-1 overflow-auto">
      {/* Column headers */}
      <div className="sticky top-0 z-10 bg-[#1a1b2e] border-b border-[#3a3b58]
                      grid grid-cols-[1fr_7rem_7rem_7rem] px-6 py-2
                      text-xs font-semibold text-[#8a8fad] uppercase tracking-wider">
        <span>Category</span>
        <span className="text-right pr-2">Budgeted</span>
        <span className="text-right pr-2">Activity</span>
        <span className="text-right">Balance</span>
      </div>

      {groups.length === 0 && (
        <div className="px-6 py-12 text-center text-[#8a8fad] text-sm">
          No categories yet. Run <code className="text-[#b3a1e6]">npm run db:seed</code> to populate defaults.
        </div>
      )}

      {groups.map((group) => (
        <div key={group.id}>
          {/* Group header row */}
          <div className="grid grid-cols-[1fr_7rem_7rem_7rem] px-6 py-2
                          bg-[#252640] border-b border-t border-[#3a3b58]">
            <span className="text-xs font-bold text-[#8a8fad] uppercase tracking-wider self-center">
              {group.name}
            </span>
            <span className="text-right text-xs text-[#8a8fad] tabular-nums self-center pr-2">
              {formatMoney(group.totalBudgeted)}
            </span>
            <Amount value={group.totalActivity} className="text-right text-xs self-center pr-2" />
            <Amount value={group.totalBalance} className="text-right text-xs font-semibold self-center" />
          </div>

          {/* Category rows */}
          {group.categories.map((cat) => (
            <div
              key={cat.id}
              className="grid grid-cols-[1fr_7rem_7rem_7rem] px-6 py-1.5
                         border-b border-[#1f2039] hover:bg-[#1f2039] transition-colors items-center"
            >
              <span className="text-sm text-[#ecf0f1]">{cat.name}</span>

              <div className="flex justify-end pr-2">
                <EditableBudgeted categoryId={cat.id} month={month} value={cat.budgeted} />
              </div>

              <Amount value={cat.activity} className="text-right text-sm pr-2" />
              <Amount value={cat.balance} className="text-right text-sm font-medium" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
