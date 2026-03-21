'use client'

import { useTransition } from 'react'
import { setBudgeted } from '@/lib/actions'
import { formatMoney } from '@/lib/budget'

export interface CoverItem {
  categoryId: string
  newBudgeted: number // milliunits — the budgeted value that brings balance to exactly 0
  rtaCost: number    // milliunits — how much RTA this consumes (= |balance|)
}

export function RtaDisplay({
  rta,
  month,
  coverItems,
}: {
  rta: number
  month: string
  coverItems: CoverItem[]
}) {
  const [isPending, startTransition] = useTransition()
  const count = coverItems.length
  // Total RTA consumed = sum of |balance| for each overspent category
  const totalRtaCost = coverItems.reduce((s, c) => s + c.rtaCost, 0)
  const willOverdraw = rta < totalRtaCost

  function handleCoverAll() {
    startTransition(async () => {
      await Promise.all(
        coverItems.map(({ categoryId, newBudgeted }) =>
          setBudgeted(categoryId, month, newBudgeted),
        ),
      )
    })
  }

  return (
    <div className="text-right">
      <p className="text-[10px] sm:text-xs text-[#8a8fad] uppercase tracking-wide">
        Ready to Assign
      </p>
      <p
        className={`text-lg sm:text-xl font-bold tabular-nums ${
          rta < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'
        }`}
      >
        {formatMoney(rta)}
      </p>
      {count > 0 && (
        <button
          onClick={handleCoverAll}
          disabled={isPending}
          title={
            willOverdraw
              ? 'Covering all overspent will make RTA negative'
              : `Budget just enough to bring ${count} overspent ${count === 1 ? 'category' : 'categories'} to $0`
          }
          className={`mt-0.5 text-[10px] leading-none transition-colors disabled:opacity-50 ${
            willOverdraw
              ? 'text-[#ce6f8f] hover:text-[#ce6f8f]/80'
              : 'text-[#e39400] hover:text-[#f2ce00]'
          }`}
        >
          {isPending ? 'Covering…' : `▲ Cover ${count} overspent`}
        </button>
      )}
    </div>
  )
}
