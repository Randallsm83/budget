'use client'

import { useTransition, useState, useRef, useEffect } from 'react'
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  setBudgeted,
  addCategory,
  addCategoryGroup,
  renameCategory,
  renameCategoryGroup,
  deleteCategory,
  deleteCategoryGroup,
  reorderGroups,
  reorderCategories,
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
  isIncome: boolean
  isTransfer: boolean
  categories: CategoryRow[]
  totalBudgeted: number
  totalActivity: number
  totalBalance: number
}

// ---------------------------------------------------------------------------
// Drag handle (6-dot grip icon)
// ---------------------------------------------------------------------------
function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3"  r="1.3" />
      <circle cx="7" cy="3"  r="1.3" />
      <circle cx="3" cy="7"  r="1.3" />
      <circle cx="7" cy="7"  r="1.3" />
      <circle cx="3" cy="11" r="1.3" />
      <circle cx="7" cy="11" r="1.3" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Sortable wrappers
// ---------------------------------------------------------------------------
type DragSlot = { dragHandle: React.ReactNode }

function SortableCatItem({ id, children }: { id: string; children: (s: DragSlot) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
        position: 'relative',
      }}
    >
      {children({
        dragHandle: (
          <button
            {...attributes}
            {...listeners}
            title="Drag to reorder"
            className="cursor-grab active:cursor-grabbing text-[#3a3b58] hover:text-[#8a8fad] touch-none flex-shrink-0"
          >
            <GripIcon />
          </button>
        ),
      })}
    </div>
  )
}

function SortableGroupItem({ id, children }: { id: string; children: (s: DragSlot) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
        position: 'relative',
      }}
    >
      {children({
        dragHandle: (
          <button
            {...attributes}
            {...listeners}
            title="Drag to reorder group"
            className="cursor-grab active:cursor-grabbing text-[#3a3b58] hover:text-[#8a8fad] touch-none flex-shrink-0"
          >
            <GripIcon />
          </button>
        ),
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline editable cell for the "Budgeted" column
// ---------------------------------------------------------------------------
function EditableBudgeted({ categoryId, month, value }: { categoryId: string; month: string; value: number }) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  function commit() {
    const amount = parseMoney(inputVal)
    setEditing(false)
    startTransition(() => setBudgeted(categoryId, month, amount))
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        className="w-28 bg-[#2a2b45] border border-[#b3a1e6] text-right text-[#ecf0f1] text-sm
                   rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#b3a1e6]"
      />
    )
  }
  return (
    <button
      onClick={() => { setInputVal((value / 1000).toFixed(2)); setEditing(true) }}
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
  const color = value < 0 ? 'text-[#ce6f8f]' : value > 0 ? 'text-[#5ccc96]' : 'text-[#8a8fad]'
  return <span className={`tabular-nums ${color} ${className}`}>{formatMoney(value)}</span>
}

// ---------------------------------------------------------------------------
// Inline text editor (rename)
// ---------------------------------------------------------------------------
function InlineRename({ value, onSave, onCancel, className = '' }: {
  value: string; onSave: (v: string) => void; onCancel: () => void; className?: string
}) {
  const [val, setVal] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.select() }, [])

  function commit() {
    const trimmed = val.trim()
    if (trimmed && trimmed !== value) onSave(trimmed); else onCancel()
  }
  return (
    <input
      ref={ref} value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel() }}
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

  useEffect(() => { if (open) ref.current?.focus() }, [open])

  function commit() {
    const trimmed = name.trim()
    if (!trimmed) { setOpen(false); return }
    startTransition(async () => { await addCategory(groupId, trimmed); setName(''); setOpen(false) })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-4 sm:px-6 py-1.5 text-xs text-[#8a8fad] hover:text-[#b3a1e6]
                   hover:bg-[#1f2039] transition-colors border-b border-[#1f2039]"
      >
        + Add Category
      </button>
    )
  }
  return (
    <div className="px-4 sm:px-6 py-1.5 border-b border-[#1f2039] flex items-center gap-2">
      <input
        ref={ref} value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setOpen(false); setName('') } }}
        placeholder="Category name…"
        disabled={isPending}
        className="flex-1 bg-[#2a2b45] border border-[#b3a1e6] text-[#ecf0f1] text-sm rounded
                   px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#b3a1e6] disabled:opacity-50"
      />
      <button onClick={() => { setOpen(false); setName('') }} className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] px-1">✕</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Category item row — dual mobile card / desktop grid layout
// ---------------------------------------------------------------------------
function CategoryItemRow({ cat, month, error, onSaveName, onDelete, dragHandle }: {
  cat: CategoryRow; month: string; error: string
  onSaveName: (name: string) => void; onDelete: () => void
  dragHandle: React.ReactNode
}) {
  const [renaming, setRenaming] = useState(false)

  return (
    <>
      {/* ── Mobile card ── */}
      <div className="sm:hidden border-b border-[#1f2039] hover:bg-[#1f2039] transition-colors">
        {renaming ? (
          <div className="flex items-center gap-2 px-4 py-2">
            {dragHandle}
            <InlineRename
              value={cat.name}
              onSave={(n) => { setRenaming(false); onSaveName(n) }}
              onCancel={() => setRenaming(false)}
              className="text-sm flex-1"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-2.5">
            {dragHandle}
            <span className="text-sm text-[#ecf0f1] flex-1 truncate min-w-0">
              {cat.name}
              {error && <span className="ml-2 text-xs text-[#ce6f8f]">{error}</span>}
            </span>
            <Amount value={cat.balance} className="text-sm flex-shrink-0" />
            <button onClick={() => setRenaming(true)} className="text-[#8a8fad] hover:text-[#b3a1e6] text-xs px-1 flex-shrink-0">✎</button>
            <button onClick={onDelete} className="text-[#8a8fad] hover:text-[#ce6f8f] text-xs px-1 flex-shrink-0">✕</button>
          </div>
        )}
      </div>

      {/* ── Desktop grid ── */}
      <div className="hidden sm:grid grid-cols-[1.5rem_1fr_7rem_7rem_7rem_2.5rem] px-3 sm:px-6 py-1.5
                      border-b border-[#1f2039] hover:bg-[#1f2039] transition-colors items-center group/cat">
        {dragHandle}
        {renaming ? (
          <InlineRename
            value={cat.name}
            onSave={(n) => { setRenaming(false); onSaveName(n) }}
            onCancel={() => setRenaming(false)}
            className="text-sm w-48"
          />
        ) : (
          <span
            onDoubleClick={() => setRenaming(true)}
            title="Double-click to rename"
            className="text-sm text-[#ecf0f1] cursor-default select-none truncate"
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
        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover/cat:opacity-100 transition-opacity">
          <button onClick={() => setRenaming(true)} title="Rename" className="text-xs text-[#8a8fad] hover:text-[#b3a1e6] px-0.5">✎</button>
          <button onClick={onDelete} title="Delete" className="text-xs text-[#8a8fad] hover:text-[#ce6f8f] px-0.5">✕</button>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Group section — dual mobile card / desktop grid header
// ---------------------------------------------------------------------------
function GroupSection({ group, month, dragHandle }: {
  group: GroupRow; month: string; dragHandle: React.ReactNode
}) {
  const [renaming, setRenaming] = useState(false)
  const [, startTransition] = useTransition()
  const [catErrors, setCatErrors] = useState<Record<string, string>>({})
  const [groupError, setGroupError] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  function handleDeleteGroup() {
    setGroupError('')
    startTransition(async () => {
      try { await deleteCategoryGroup(group.id) }
      catch (e) {
        const msg = e instanceof Error ? e.message : 'Cannot delete'
        setGroupError(msg)
        setTimeout(() => setGroupError(''), 3000)
      }
    })
  }

  function handleDeleteCategory(id: string) {
    setCatErrors((p) => ({ ...p, [id]: '' }))
    startTransition(async () => {
      try { await deleteCategory(id) }
      catch (e) {
        const msg = e instanceof Error ? e.message : 'Cannot delete'
        setCatErrors((p) => ({ ...p, [id]: msg }))
        setTimeout(() => setCatErrors((p) => ({ ...p, [id]: '' })), 3000)
      }
    })
  }

  function handleCatDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = group.categories.map((c) => c.id)
    const newOrder = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    startTransition(() => reorderCategories(newOrder))
  }

  const nameEl = (mobile: boolean) =>
    renaming ? (
      <InlineRename
        value={group.name}
        onSave={(name) => { setRenaming(false); startTransition(() => renameCategoryGroup(group.id, name)) }}
        onCancel={() => setRenaming(false)}
        className={mobile ? 'text-xs font-bold flex-1' : 'text-xs font-bold w-48'}
      />
    ) : mobile ? (
      <span className="text-xs font-bold text-[#8a8fad] uppercase tracking-wider flex-1 truncate">
        {group.name}
        {groupError && <span className="ml-2 text-[#ce6f8f] normal-case font-normal tracking-normal">{groupError}</span>}
      </span>
    ) : (
      <span
        onDoubleClick={() => setRenaming(true)}
        title="Double-click to rename"
        className="text-xs font-bold text-[#8a8fad] uppercase tracking-wider cursor-default select-none"
      >
        {group.name}
        {groupError && <span className="ml-2 text-[#ce6f8f] normal-case font-normal tracking-normal">{groupError}</span>}
      </span>
    )

  const actionBtns = (mobile: boolean) => (
    <div className={`flex items-center gap-0.5 flex-shrink-0 ${mobile ? '' : 'opacity-0 group-hover/grp:opacity-100 transition-opacity'}`}>
      <button onClick={() => setRenaming(true)} title="Rename group" className="text-xs text-[#8a8fad] hover:text-[#b3a1e6] px-0.5">✎</button>
      <button
        onClick={handleDeleteGroup}
        title={group.categories.length > 0 ? 'Remove all categories first' : 'Delete group'}
        disabled={group.categories.length > 0}
        className="text-xs text-[#8a8fad] hover:text-[#ce6f8f] px-0.5 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-[#8a8fad]"
      >✕</button>
    </div>
  )

  return (
    <div>
      {/* ── Mobile group header ── */}
      <div className="sm:hidden flex items-center gap-2 px-4 py-2 bg-[#252640] border-b border-t border-[#3a3b58]">
        {dragHandle}
        {nameEl(true)}
        {!renaming && <Amount value={group.totalBalance} className="text-xs flex-shrink-0" />}
        {actionBtns(true)}
      </div>

      {/* ── Desktop group header ── */}
      <div className="hidden sm:grid grid-cols-[1.5rem_1fr_7rem_7rem_7rem_2.5rem] px-3 sm:px-6 py-2
                      bg-[#252640] border-b border-t border-[#3a3b58] group/grp items-center">
        {dragHandle}
        {nameEl(false)}
        <span className="text-right text-xs text-[#8a8fad] tabular-nums pr-2">{formatMoney(group.totalBudgeted)}</span>
        <Amount value={group.totalActivity} className="text-right text-xs pr-2" />
        <Amount value={group.totalBalance} className="text-right text-xs font-semibold" />
        {actionBtns(false)}
      </div>

      {/* Category rows */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatDragEnd}>
        <SortableContext items={group.categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {group.categories.map((cat) => (
            <SortableCatItem key={cat.id} id={cat.id}>
              {({ dragHandle: catHandle }) => (
                <CategoryItemRow
                  cat={cat}
                  month={month}
                  error={catErrors[cat.id] ?? ''}
                  onSaveName={(name) => startTransition(() => renameCategory(cat.id, name))}
                  onDelete={() => handleDeleteCategory(cat.id)}
                  dragHandle={catHandle}
                />
              )}
            </SortableCatItem>
          ))}
        </SortableContext>
      </DndContext>

      <AddCategoryRow groupId={group.id} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add group row
// ---------------------------------------------------------------------------
type GroupType = 'expense' | 'income' | 'transfer'

function AddGroupRow() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [groupType, setGroupType] = useState<GroupType>('expense')
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) ref.current?.focus() }, [open])

  function commit() {
    const trimmed = name.trim()
    if (!trimmed) { setOpen(false); return }
    startTransition(async () => {
      await addCategoryGroup(trimmed, groupType === 'income', groupType === 'transfer')
      setName(''); setGroupType('expense'); setOpen(false)
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-4 sm:px-6 py-3 text-sm text-[#8a8fad] hover:text-[#b3a1e6]
                   hover:bg-[#1f2039] transition-colors border-t border-[#3a3b58] mt-2"
      >
        + Add Group
      </button>
    )
  }

  return (
    <div className="px-4 sm:px-6 py-3 border-t border-[#3a3b58] mt-2 space-y-2">
      <div className="flex rounded-lg bg-[#2a2b45] p-0.5 w-fit">
        {(['expense', 'income', 'transfer'] as const).map((t) => (
          <button
            key={t} type="button" onClick={() => setGroupType(t)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              groupType === t
                ? t === 'income' ? 'bg-[#5ccc96] text-[#1a1b2e]'
                  : t === 'transfer' ? 'bg-[#42b3c2] text-[#1a1b2e]'
                  : 'bg-[#1f2039] text-[#ecf0f1] shadow'
                : 'text-[#8a8fad] hover:text-[#ecf0f1]'
            }`}
          >
            {t === 'income' ? 'Income' : t === 'transfer' ? 'Transfer' : 'Expense'}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={ref} value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setOpen(false); setName(''); setGroupType('expense') }
          }}
          placeholder={groupType === 'income' ? 'e.g. Salary, Freelance…' : groupType === 'transfer' ? 'e.g. Transfers…' : 'Group name…'}
          disabled={isPending}
          className="flex-1 bg-[#2a2b45] border border-[#b3a1e6] text-[#ecf0f1] text-sm rounded
                     px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#b3a1e6] disabled:opacity-50"
        />
        <button onClick={() => { setOpen(false); setName(''); setGroupType('expense') }} className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] px-1">✕</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main table
// ---------------------------------------------------------------------------
export function BudgetTable({ month, groups }: { month: string; groups: GroupRow[] }) {
  const [, startTransition] = useTransition()
  const incomeGroups   = groups.filter((g) => g.isIncome)
  const expenseGroups  = groups.filter((g) => !g.isIncome && !g.isTransfer)
  const transferGroups = groups.filter((g) => g.isTransfer)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  function makeDragEnd(section: GroupRow[]) {
    return (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const ids = section.map((g) => g.id)
      const newOrder = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
      startTransition(() => reorderGroups(newOrder))
    }
  }

  function renderSection(sectionGroups: GroupRow[]) {
    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={makeDragEnd(sectionGroups)}>
        <SortableContext items={sectionGroups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          {sectionGroups.map((group) => (
            <SortableGroupItem key={group.id} id={group.id}>
              {({ dragHandle }) => <GroupSection group={group} month={month} dragHandle={dragHandle} />}
            </SortableGroupItem>
          ))}
        </SortableContext>
      </DndContext>
    )
  }

  function sectionLabel(label: string, color: string, cols: [string, string, string]) {
    return (
      <div className={`hidden sm:grid grid-cols-[1.5rem_1fr_7rem_7rem_7rem_2.5rem] px-6 py-1.5
                       bg-[#1a1b2e] border-b border-[#3a3b58] text-[9px] font-bold ${color} uppercase tracking-widest`}>
        <span /><span>{label}</span>
        <span className="text-right pr-2">{cols[0]}</span>
        <span className="text-right pr-2">{cols[1]}</span>
        <span className="text-right">{cols[2]}</span>
        <span />
      </div>
    )
  }

  return (
    <div className="flex-1 sm:overflow-x-auto">
      <div className="sm:min-w-[33rem]">
        {/* Column headers — desktop only */}
        <div className="hidden sm:grid sticky top-0 z-10 bg-[#1a1b2e] border-b border-[#3a3b58]
                        grid-cols-[1.5rem_1fr_7rem_7rem_7rem_2.5rem] px-6 py-2
                        text-xs font-semibold text-[#8a8fad] uppercase tracking-wider">
          <span />
          <span>Category</span>
          <span className="text-right pr-2" title="Money you've assigned to this category for the month">Budgeted</span>
          <span className="text-right pr-2" title="Actual spending this month (negative = outflow)">Activity</span>
          <span className="text-right" title="Budgeted + Activity. Negative means overspent.">Balance</span>
          <span />
        </div>

        {/* Income */}
        {incomeGroups.length > 0 && (
          <>
            {sectionLabel('💰 Income', 'text-[#5ccc96]', ['Expected', 'Received', 'vs Expected'])}
            {renderSection(incomeGroups)}
          </>
        )}

        {/* Expenses */}
        {expenseGroups.length === 0 && incomeGroups.length === 0 && transferGroups.length === 0 && (
          <div className="px-6 py-12 text-center text-[#8a8fad] text-sm">
            No categories yet.{' '}
            <span className="text-[#b3a1e6]">Use &ldquo;+ Add Group&rdquo; below to get started.</span>
          </div>
        )}
        {expenseGroups.length > 0 && (
          <>
            {incomeGroups.length > 0 && sectionLabel('💸 Expenses', 'text-[#8a8fad]', ['Budgeted', 'Activity', 'Balance'])}
            {renderSection(expenseGroups)}
          </>
        )}

        {/* Transfers */}
        {transferGroups.length > 0 && (
          <>
            {sectionLabel('↔️ Transfers', 'text-[#42b3c2]', ['Budgeted', 'Activity', 'Balance'])}
            {renderSection(transferGroups)}
          </>
        )}

        <AddGroupRow />
      </div>
    </div>
  )
}
