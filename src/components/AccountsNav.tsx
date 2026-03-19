'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, DragEndEvent, PointerSensor, TouchSensor,
  useSensor, useSensors, closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, arrayMove, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { reorderAccounts } from '@/lib/actions'
import { formatMoney } from '@/lib/budget'
import { NavLink } from '@/components/NavLink'

interface Account {
  id: string
  name: string
  type: string
  balance: number
  needsRelink: boolean
}

const TYPE_ICONS: Record<string, string> = {
  checking: '🏦', savings: '💵', credit_card: '💳', cash: '💸',
  loan: '🏠', real_estate: '🏠', vehicle: '🚗', investment: '📈', other: '📁',
}

function SortableAccountItem({ account, balanceColor }: { account: Account; balanceColor: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      <NavLink href={`/accounts/${account.id}`}>
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-[#3a3b58] hover:text-[#8a8fad] touch-none flex-shrink-0 text-xs px-0.5"
          title="Drag to reorder"
          tabIndex={-1}
        >
          ⠿
        </button>
        <span className="text-sm leading-none flex-shrink-0">{TYPE_ICONS[account.type] ?? '📁'}</span>
        <span className="flex-1 truncate text-xs">{account.name}</span>
        {account.needsRelink && (
          <span className="text-[#e39400] text-xs flex-shrink-0" title="Bank connection needs attention">⚠</span>
        )}
        <span className={`text-xs tabular-nums flex-shrink-0 ${balanceColor}`}>{formatMoney(account.balance)}</span>
      </NavLink>
    </div>
  )
}

function SortableSection({
  label, labelColor, accounts, total,
}: {
  label: string; labelColor: string; accounts: Account[]; total: number
}) {
  const [, startTransition] = useTransition()
  const router = useRouter()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const balanceColor =
    labelColor === 'text-[#5ccc96]' ? 'text-[#5ccc96]'
    : labelColor === 'text-[#f2ce00]' ? 'text-[#f2ce00]'
    : labelColor === 'text-[#00a3cc]' ? 'text-[#00a3cc]'
    : 'text-[#ce6f8f]'

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = accounts.map((a) => a.id)
    const newOrder = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    startTransition(async () => {
      await reorderAccounts(newOrder)
      router.refresh()
    })
  }

  return (
    <>
      <div className="px-3 pt-2 pb-0.5 flex justify-between items-center">
        <span className={`text-[9px] font-semibold ${labelColor} uppercase tracking-widest`}>{label}</span>
        <span className={`text-[9px] ${labelColor} tabular-nums`}>{formatMoney(total)}</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={accounts.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          {accounts.map((account) => (
            <SortableAccountItem key={account.id} account={account} balanceColor={balanceColor} />
          ))}
        </SortableContext>
      </DndContext>
    </>
  )
}

export function AccountsNav({
  cashAccounts, investmentAccounts, propertyAccounts, liabilities,
  cashTotal, investmentTotal, propertyTotal, liabilityTotal,
}: {
  cashAccounts: Account[]
  investmentAccounts: Account[]
  propertyAccounts: Account[]
  liabilities: Account[]
  cashTotal: number
  investmentTotal: number
  propertyTotal: number
  liabilityTotal: number
}) {
  return (
    <>
      {cashAccounts.length > 0 && (
        <SortableSection label="Cash & Bank" labelColor="text-[#5ccc96]" accounts={cashAccounts} total={cashTotal} />
      )}
      {investmentAccounts.length > 0 && (
        <SortableSection label="Investments" labelColor="text-[#f2ce00]" accounts={investmentAccounts} total={investmentTotal} />
      )}
      {propertyAccounts.length > 0 && (
        <SortableSection label="Property" labelColor="text-[#00a3cc]" accounts={propertyAccounts} total={propertyTotal} />
      )}
      {liabilities.length > 0 && (
        <SortableSection label="Liabilities" labelColor="text-[#ce6f8f]" accounts={liabilities} total={liabilityTotal} />
      )}
    </>
  )
}
