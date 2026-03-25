'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
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
  addCategory,
  addCategoryGroup,
  renameCategory,
  renameCategoryGroup,
  deleteCategory,
  deleteCategoryGroup,
  reorderGroups,
  reorderCategories,
} from '@/lib/actions'

interface CatItem {
  id: string
  name: string
  sortOrder: number
}

export interface ManagedGroup {
  id: string
  name: string
  isIncome: boolean
  categories: CatItem[]
}

// ---------------------------------------------------------------------------
// Grip icon
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
// Inline rename input
// ---------------------------------------------------------------------------
function InlineRename({ value, onSave, onCancel }: {
  value: string; onSave: (v: string) => void; onCancel: () => void
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
      className="bg-[#2a2b45] border border-[#b3a1e6] text-[#ecf0f1] rounded px-2 py-0.5 text-sm
                 focus:outline-none focus:ring-1 focus:ring-[#b3a1e6] flex-1 min-w-0"
    />
  )
}

// ---------------------------------------------------------------------------
// Sortable category row
// ---------------------------------------------------------------------------
function SortableCategoryRow({
  cat, groupId, onDeleted, onRenamed,
}: {
  cat: CatItem
  groupId: string
  onDeleted: (id: string) => void
  onRenamed: (id: string, name: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id })
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    setConfirming(false)
    startTransition(async () => {
      try {
        await deleteCategory(cat.id)
        onDeleted(cat.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Cannot delete')
        setTimeout(() => setError(''), 3000)
      }
    })
  }

  function handleRename(name: string) {
    setRenaming(false)
    onRenamed(cat.id, name)
    startTransition(() => renameCategory(cat.id, name))
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-2 px-3 py-2 border-b border-[#252640] hover:bg-[#1f2039] group"
    >
      <button
        {...attributes} {...listeners}
        className="cursor-grab active:cursor-grabbing text-[#3a3b58] hover:text-[#8a8fad] touch-none flex-shrink-0"
        title="Drag to reorder"
      >
        <GripIcon />
      </button>

      {renaming ? (
        <InlineRename value={cat.name} onSave={handleRename} onCancel={() => setRenaming(false)} />
      ) : (
        <span
          onDoubleClick={() => setRenaming(true)}
          title="Double-click to rename"
          className="text-sm text-[#ecf0f1] flex-1 cursor-default select-none truncate"
        >
          {cat.name}
          {error && <span className="ml-2 text-xs text-[#ce6f8f]">{error}</span>}
        </span>
      )}

      {!renaming && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={() => setRenaming(true)}
            className="text-xs text-[#8a8fad] hover:text-[#b3a1e6] px-1.5 py-0.5 rounded"
            title="Rename"
          >✎</button>
          {confirming ? (
            <>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="text-xs text-[#ce6f8f] hover:text-white px-1.5 py-0.5 rounded bg-[#ce6f8f]/20"
              >Delete</button>
              <button
                onClick={() => setConfirming(false)}
                className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] px-1.5 py-0.5"
              >Cancel</button>
            </>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="text-xs text-[#8a8fad] hover:text-[#ce6f8f] px-1.5 py-0.5 rounded"
              title="Delete category"
            >✕</button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Group card (sortable)
// ---------------------------------------------------------------------------
function SortableGroupCard({
  group: initialGroup,
  onDeleted,
  onUpdated,
}: {
  group: ManagedGroup
  onDeleted: (id: string) => void
  onUpdated: (id: string, updates: Partial<ManagedGroup>) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: initialGroup.id })
  const [group, setGroup] = useState(initialGroup)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingCat, setAddingCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [groupError, setGroupError] = useState('')
  const [isPending, startTransition] = useTransition()
  const addInputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  useEffect(() => { if (addingCat) addInputRef.current?.focus() }, [addingCat])

  function handleCatDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = group.categories.map((c) => c.id)
    const newOrder = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    setGroup((g) => ({
      ...g,
      categories: newOrder.map((id, i) => ({ ...g.categories.find((c) => c.id === id)!, sortOrder: i })),
    }))
    startTransition(() => reorderCategories(newOrder))
  }

  function handleGroupRename(name: string) {
    setRenaming(false)
    setGroup((g) => ({ ...g, name }))
    onUpdated(group.id, { name })
    startTransition(() => renameCategoryGroup(group.id, name))
  }

  function handleGroupDelete() {
    setConfirmDelete(false)
    startTransition(async () => {
      try {
        await deleteCategoryGroup(group.id)
        onDeleted(group.id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Cannot delete'
        setGroupError(msg)
        setTimeout(() => setGroupError(''), 3000)
      }
    })
  }

  function handleAddCategory() {
    const name = newCatName.trim()
    if (!name) { setAddingCat(false); return }
    setAddingCat(false)
    setNewCatName('')
    startTransition(async () => {
      await addCategory(group.id, name)
      // Refresh by triggering parent re-render isn't possible here easily,
      // so we optimistically add with a temporary id that the server action will replace on navigation
      setGroup((g) => ({
        ...g,
        categories: [...g.categories, { id: `tmp-${Date.now()}`, name, sortOrder: g.categories.length }],
      }))
    })
  }

  function handleCatDeleted(catId: string) {
    setGroup((g) => ({ ...g, categories: g.categories.filter((c) => c.id !== catId) }))
  }

  function handleCatRenamed(catId: string, name: string) {
    setGroup((g) => ({ ...g, categories: g.categories.map((c) => c.id === catId ? { ...c, name } : c) }))
  }

  const badge = group.isIncome
    ? <span className="text-[10px] bg-[#5ccc96]/15 text-[#5ccc96] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">Income</span>
    : <span className="text-[10px] bg-[#3a3b58] text-[#8a8fad] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">Expense</span>

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="bg-[#1f2039] border border-[#3a3b58] rounded-lg overflow-hidden"
    >
      {/* Group header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#252640] border-b border-[#3a3b58] group/grp">
        <button
          {...attributes} {...listeners}
          className="cursor-grab active:cursor-grabbing text-[#3a3b58] hover:text-[#8a8fad] touch-none flex-shrink-0"
          title="Drag to reorder group"
        >
          <GripIcon />
        </button>

        {renaming ? (
          <InlineRename value={group.name} onSave={handleGroupRename} onCancel={() => setRenaming(false)} />
        ) : (
          <span
            onDoubleClick={() => setRenaming(true)}
            title="Double-click to rename"
            className="text-sm font-semibold text-[#ecf0f1] flex-1 cursor-default select-none truncate"
          >
            {group.name}
            {groupError && <span className="ml-2 text-xs text-[#ce6f8f] font-normal">{groupError}</span>}
          </span>
        )}

        {badge}

        {!renaming && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover/grp:opacity-100 transition-opacity flex-shrink-0">
            <button
              onClick={() => setRenaming(true)}
              className="text-xs text-[#8a8fad] hover:text-[#b3a1e6] px-1.5 py-0.5 rounded"
              title="Rename group"
            >✎</button>
            {confirmDelete ? (
              <>
                <button
                  onClick={handleGroupDelete}
                  disabled={isPending || group.categories.length > 0}
                  className="text-xs text-[#ce6f8f] hover:text-white px-1.5 py-0.5 rounded bg-[#ce6f8f]/20 disabled:opacity-40"
                >Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] px-1.5 py-0.5">Cancel</button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={group.categories.length > 0}
                title={group.categories.length > 0 ? 'Remove all categories first' : 'Delete group'}
                className="text-xs text-[#8a8fad] hover:text-[#ce6f8f] px-1.5 py-0.5 rounded disabled:opacity-30 disabled:cursor-not-allowed"
              >✕</button>
            )}
          </div>
        )}
      </div>

      {/* Category rows */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatDragEnd}>
        <SortableContext items={group.categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {group.categories.map((cat) => (
            <SortableCategoryRow
              key={cat.id}
              cat={cat}
              groupId={group.id}
              onDeleted={handleCatDeleted}
              onRenamed={handleCatRenamed}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Add category row */}
      {addingCat ? (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-[#252640]">
          <input
            ref={addInputRef}
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onBlur={handleAddCategory}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddCategory()
              if (e.key === 'Escape') { setAddingCat(false); setNewCatName('') }
            }}
            placeholder="Category name…"
            className="flex-1 bg-[#2a2b45] border border-[#b3a1e6] text-[#ecf0f1] text-sm rounded px-2 py-0.5
                       focus:outline-none focus:ring-1 focus:ring-[#b3a1e6]"
          />
          <button onClick={() => { setAddingCat(false); setNewCatName('') }} className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] px-1">✕</button>
        </div>
      ) : (
        <button
          onClick={() => setAddingCat(true)}
          className="w-full text-left px-4 py-2 text-xs text-[#8a8fad] hover:text-[#b3a1e6] hover:bg-[#1f2039]
                     transition-colors border-t border-[#252640]"
        >
          + Add Category
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main CategoryManager
// ---------------------------------------------------------------------------
export function CategoryManager({ initialGroups }: { initialGroups: ManagedGroup[] }) {
  const [groups, setGroups] = useState(initialGroups)
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupType, setNewGroupType] = useState<'expense' | 'income'>('expense')
  const [isPending, startTransition] = useTransition()
  const addGroupRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  useEffect(() => { if (addingGroup) addGroupRef.current?.focus() }, [addingGroup])

  function handleGroupDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = groups.map((g) => g.id)
    const newOrder = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    setGroups((gs) => newOrder.map((id) => gs.find((g) => g.id === id)!))
    startTransition(() => reorderGroups(newOrder))
  }

  function handleAddGroup() {
    const name = newGroupName.trim()
    if (!name) { setAddingGroup(false); return }
    setAddingGroup(false)
    setNewGroupName('')
    startTransition(async () => {
      await addCategoryGroup(name, newGroupType === 'income')
      // Optimistic add — real ID comes on next page load
      setGroups((gs) => [...gs, {
        id: `tmp-${Date.now()}`,
        name,
        isIncome: newGroupType === 'income',
        categories: [],
      }])
    })
  }

  function handleGroupDeleted(id: string) {
    setGroups((gs) => gs.filter((g) => g.id !== id))
  }

  function handleGroupUpdated(id: string, updates: Partial<ManagedGroup>) {
    setGroups((gs) => gs.map((g) => g.id === id ? { ...g, ...updates } : g))
  }

  const incomeGroups  = groups.filter((g) => g.isIncome)
  const expenseGroups = groups.filter((g) => !g.isIncome)

  function renderGroupList(sectionGroups: ManagedGroup[]) {
    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleGroupDragEnd}>
        <SortableContext items={sectionGroups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {sectionGroups.map((group) => (
              <SortableGroupCard
                key={group.id}
                group={group}
                onDeleted={handleGroupDeleted}
                onUpdated={handleGroupUpdated}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    )
  }

  return (
    <div className="space-y-8">
      {/* Income groups */}
      {incomeGroups.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-[#5ccc96] uppercase tracking-widest mb-3">Income</h2>
          {renderGroupList(incomeGroups)}
        </section>
      )}

      {/* Expense groups */}
      {expenseGroups.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-[#8a8fad] uppercase tracking-widest mb-3">Expenses</h2>
          {renderGroupList(expenseGroups)}
        </section>
      )}

      {groups.length === 0 && (
        <p className="text-sm text-[#8a8fad] text-center py-8">No groups yet. Add one below.</p>
      )}

      {/* Add group */}
      <div className="border-t border-[#3a3b58] pt-6">
        {addingGroup ? (
          <div className="bg-[#1f2039] border border-[#3a3b58] rounded-lg p-4 space-y-3">
            <div className="flex rounded-lg bg-[#2a2b45] p-0.5 w-fit">
              {(['expense', 'income'] as const).map((t) => (
                <button
                  key={t} type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setNewGroupType(t); addGroupRef.current?.focus() }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    newGroupType === t
                      ? t === 'income' ? 'bg-[#5ccc96] text-[#1a1b2e]' : 'bg-[#1f2039] text-[#ecf0f1] shadow'
                      : 'text-[#8a8fad] hover:text-[#ecf0f1]'
                  }`}
                >
                  {t === 'income' ? 'Income' : 'Expense'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={addGroupRef}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onBlur={handleAddGroup}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddGroup()
                  if (e.key === 'Escape') { setAddingGroup(false); setNewGroupName(''); setNewGroupType('expense') }
                }}
                placeholder={newGroupType === 'income' ? 'e.g. Salary, Freelance…' : 'Group name…'}
                disabled={isPending}
                className="flex-1 bg-[#2a2b45] border border-[#b3a1e6] text-[#ecf0f1] text-sm rounded
                           px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#b3a1e6] disabled:opacity-50"
              />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setAddingGroup(false); setNewGroupName(''); setNewGroupType('expense') }}
                className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] px-1"
              >✕</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingGroup(true)}
            className="w-full text-left px-4 py-3 text-sm text-[#8a8fad] hover:text-[#b3a1e6]
                       hover:bg-[#1f2039] transition-colors rounded-lg border border-dashed border-[#3a3b58]
                       hover:border-[#b3a1e6]"
          >
            + Add Group
          </button>
        )}
      </div>
    </div>
  )
}
