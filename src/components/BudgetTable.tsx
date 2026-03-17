'use client'

import { useTransition, useState, useRef, useEffect } from 'react'
import {
  setBudgeted,
  addCategory,
  addCategoryGroup,
  renameCategory,
  renameCategoryGroup,
  deleteCategory,
  deleteCategoryGroup,
} from '@/lib/actions'
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
// Inline text editor (rename)
// ---------------------------------------------------------------------------
function InlineRename({
  value,
  onSave,
  onCancel,
  className = '',
}: {
  value: string
  onSave: (v: string) => void
  onCancel: () => void
  className?: string
}) {
  const [val, setVal] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.select()
  }, [])

  function commit() {
    const trimmed = val.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    else onCancel()
  }

  return (
    <input
      ref={ref}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onCancel()
      }}
      className={`bg-[#2a2b45] border border-[#b3a1e6] text-[#ecf0f1] rounded px-2 py-0.5
                  focus:outline-none focus:ring-1 focus:ring-[#b3a1e6] ${className}`}
    />
  )
}

// ---------------------------------------------------------------------------
// Add-category inline row
// ---------------------------------------------------------------------------
function AddCategoryRow({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])

  function commit() {
    const trimmed = name.trim()
    if (!trimmed) { setOpen(false); return }
    startTransition(async () => {
      await addCategory(groupId, trimmed)
      setName('')
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-6 py-1.5 text-xs text-[#8a8fad] hover:text-[#b3a1e6]
                   hover:bg-[#1f2039] transition-colors border-b border-[#1f2039]"
      >
        + Add Category
      </button>
    )
  }

  return (
    <div className="px-6 py-1.5 border-b border-[#1f2039] flex items-center gap-2">
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setOpen(false); setName('') }
        }}
        placeholder="Category name…"
        disabled={isPending}
        className="flex-1 bg-[#2a2b45] border border-[#b3a1e6] text-[#ecf0f1] text-sm rounded
                   px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#b3a1e6] disabled:opacity-50"
      />
      <button
        onClick={() => { setOpen(false); setName('') }}
        className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] px-1"
      >
        ✕
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Group section
// ---------------------------------------------------------------------------
function GroupSection({ group, month }: { group: GroupRow; month: string }) {
  const [renaming, setRenaming] = useState(false)
  const [, startTransition] = useTransition()
  const [catErrors, setCatErrors] = useState<Record<string, string>>({})
  const [groupError, setGroupError] = useState('')

  function saveGroupName(name: string) {
    setRenaming(false)
    startTransition(() => renameCategoryGroup(group.id, name))
  }

  function saveCatName(id: string, name: string) {
    startTransition(() => renameCategory(id, name))
  }

  function handleDeleteGroup() {
    setGroupError('')
    startTransition(async () => {
      try {
        await deleteCategoryGroup(group.id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Cannot delete'
        setGroupError(msg)
        setTimeout(() => setGroupError(''), 3000)
      }
    })
  }

  function handleDeleteCategory(id: string) {
    setCatErrors((prev) => ({ ...prev, [id]: '' }))
    startTransition(async () => {
      try {
        await deleteCategory(id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Cannot delete'
        setCatErrors((prev) => ({ ...prev, [id]: msg }))
        setTimeout(() => setCatErrors((prev) => ({ ...prev, [id]: '' })), 3000)
      }
    })
  }

  return (
    <div>
      {/* Group header */}
      <div className="grid grid-cols-[1fr_7rem_7rem_7rem_2rem] px-6 py-2
                      bg-[#252640] border-b border-t border-[#3a3b58] group/grp items-center">
        {renaming ? (
          <InlineRename
            value={group.name}
            onSave={saveGroupName}
            onCancel={() => setRenaming(false)}
            className="text-xs font-bold w-48"
          />
        ) : (
          <span
            onDoubleClick={() => setRenaming(true)}
            title="Double-click to rename"
            className="text-xs font-bold text-[#8a8fad] uppercase tracking-wider cursor-default select-none"
          >
            {group.name}
            {groupError && (
              <span className="ml-2 text-[#ce6f8f] normal-case font-normal tracking-normal">
                {groupError}
              </span>
            )}
          </span>
        )}
        <span className="text-right text-xs text-[#8a8fad] tabular-nums pr-2">
          {formatMoney(group.totalBudgeted)}
        </span>
        <Amount value={group.totalActivity} className="text-right text-xs pr-2" />
        <Amount value={group.totalBalance} className="text-right text-xs font-semibold" />
        <button
          onClick={handleDeleteGroup}
          title={group.categories.length > 0 ? 'Remove all categories first' : 'Delete group'}
          disabled={group.categories.length > 0}
          className="opacity-0 group-hover/grp:opacity-100 text-xs text-[#3a3b58]
                     hover:text-[#ce6f8f] transition-all disabled:cursor-not-allowed
                     disabled:opacity-20 disabled:hover:text-[#3a3b58]"
        >
          ✕
        </button>
      </div>

      {/* Category rows */}
      {group.categories.map((cat) => (
        <CategoryItemRow
          key={cat.id}
          cat={cat}
          month={month}
          error={catErrors[cat.id] ?? ''}
          onSaveName={(name) => saveCatName(cat.id, name)}
          onDelete={() => handleDeleteCategory(cat.id)}
        />
      ))}

      <AddCategoryRow groupId={group.id} />
    </div>
  )
}

// Extracted to avoid hook-in-loop issue
function CategoryItemRow({
  cat,
  month,
  error,
  onSaveName,
  onDelete,
}: {
  cat: CategoryRow
  month: string
  error: string
  onSaveName: (name: string) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)

  return (
    <div
      className="grid grid-cols-[1fr_7rem_7rem_7rem_2rem] px-6 py-1.5
                 border-b border-[#1f2039] hover:bg-[#1f2039] transition-colors
                 items-center group/cat"
    >
      {renaming ? (
        <InlineRename
          value={cat.name}
          onSave={(name) => { setRenaming(false); onSaveName(name) }}
          onCancel={() => setRenaming(false)}
          className="text-sm w-48"
        />
      ) : (
        <span
          onDoubleClick={() => setRenaming(true)}
          title="Double-click to rename"
          className="text-sm text-[#ecf0f1] cursor-default select-none"
        >
          {cat.name}
          {error && <span className="ml-2 text-xs text-[#ce6f8f]">{error}</span>}
        </span>
      )}

      <div className="flex justify-end pr-2">
        <EditableBudgeted categoryId={cat.id} month={month} value={cat.budgeted} />
      </div>

      <Amount value={cat.activity} className="text-right text-sm pr-2" />
      <Amount value={cat.balance} className="text-right text-sm font-medium" />

      <button
        onClick={onDelete}
        title="Delete category"
        className="opacity-0 group-hover/cat:opacity-100 text-xs text-[#3a3b58]
                   hover:text-[#ce6f8f] transition-all"
      >
        ✕
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add group row
// ---------------------------------------------------------------------------
function AddGroupRow() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])

  function commit() {
    const trimmed = name.trim()
    if (!trimmed) { setOpen(false); return }
    startTransition(async () => {
      await addCategoryGroup(trimmed)
      setName('')
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-6 py-3 text-sm text-[#8a8fad] hover:text-[#b3a1e6]
                   hover:bg-[#1f2039] transition-colors border-t border-[#3a3b58] mt-2"
      >
        + Add Group
      </button>
    )
  }

  return (
    <div className="px-6 py-3 border-t border-[#3a3b58] mt-2 flex items-center gap-2">
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setOpen(false); setName('') }
        }}
        placeholder="Group name…"
        disabled={isPending}
        className="flex-1 bg-[#2a2b45] border border-[#b3a1e6] text-[#ecf0f1] text-sm rounded
                   px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#b3a1e6] disabled:opacity-50"
      />
      <button
        onClick={() => { setOpen(false); setName('') }}
        className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] px-1"
      >
        ✕
      </button>
    </div>
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
                      grid grid-cols-[1fr_7rem_7rem_7rem_2rem] px-6 py-2
                      text-xs font-semibold text-[#8a8fad] uppercase tracking-wider">
        <span>Category</span>
        <span className="text-right pr-2">Budgeted</span>
        <span className="text-right pr-2">Activity</span>
        <span className="text-right">Balance</span>
        <span />
      </div>

      {groups.length === 0 && (
        <div className="px-6 py-12 text-center text-[#8a8fad] text-sm">
          No categories yet.{' '}
          <span className="text-[#b3a1e6]">Use &ldquo;+ Add Group&rdquo; below to get started.</span>
        </div>
      )}

      {groups.map((group) => (
        <GroupSection key={group.id} group={group} month={month} />
      ))}

      <AddGroupRow />
    </div>
  )
}
