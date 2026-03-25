'use client'

import { useEffect, useState } from 'react'

interface ForecastCategory {
  categoryId: string
  name: string
  groupName: string
  budgetedDollars: number
  spentDollars: number
  projectedDollars: number
  projectedOverspendDollars: number
  pctUsed: number | null
}

interface Pace {
  daysElapsed: number
  daysInMonth: number
  pacePercent: number
}

interface Props {
  month: string
}

function fmt(dollars: number): string {
  return `$${Math.abs(dollars).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function SpendingForecastCard({ month }: Props) {
  const [categories, setCategories] = useState<ForecastCategory[]>([])
  const [pace, setPace] = useState<Pace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ai/forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load forecast')
        if (!cancelled) {
          setCategories((data.categories ?? []) as ForecastCategory[])
          setPace(data.pace as Pace)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load forecast')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [month])

  const atRisk = categories.filter((c) => c.projectedOverspendDollars > 0)
  const onTrack = categories.filter((c) => c.projectedOverspendDollars <= 0)

  return (
    <div className="border border-[#3a3b58] rounded-lg bg-[#1f2039] p-3 sm:p-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-xs sm:text-sm font-semibold text-[#e39400] uppercase tracking-wider">
          Spending Forecast
        </h3>
        {pace && (
          <span className="text-[10px] text-[#8a8fad] shrink-0">
            Day {pace.daysElapsed}/{pace.daysInMonth} — {pace.pacePercent}% through month
          </span>
        )}
      </div>

      {loading && <p className="text-xs text-[#8a8fad]">Calculating projections…</p>}
      {error && <p className="text-xs text-[#ce6f8f]">{error}</p>}

      {!loading && !error && categories.length === 0 && (
        <p className="text-xs text-[#8a8fad]">No budgeted categories with spending yet.</p>
      )}

      {!loading && !error && categories.length > 0 && (
        <div className="space-y-1.5">
          {atRisk.length > 0 && (
            <>
              <p className="text-[10px] text-[#ce6f8f] font-semibold uppercase tracking-wider mt-0.5 mb-1">At risk</p>
              {atRisk.map((cat) => (
                <ForecastRow key={cat.categoryId} cat={cat} />
              ))}
            </>
          )}
          {onTrack.length > 0 && (
            <>
              <p className="text-[10px] text-[#5ccc96] font-semibold uppercase tracking-wider mt-2 mb-1">On track</p>
              {onTrack.slice(0, 4).map((cat) => (
                <ForecastRow key={cat.categoryId} cat={cat} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ForecastRow({ cat }: { cat: ForecastCategory }) {
  const isOver = cat.projectedOverspendDollars > 0
  // Bar represents spent as % of budget; cap at 100% visually but clip with color
  const barPct = cat.pctUsed !== null ? Math.min(cat.pctUsed, 100) : 0
  const barColor = isOver ? '#ce6f8f' : barPct >= 80 ? '#e39400' : '#5ccc96'

  return (
    <div className="bg-[#1a1b2e] rounded p-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-[#ecf0f1] truncate">{cat.name}</span>
        <span className={`text-[10px] tabular-nums shrink-0 ${isOver ? 'text-[#ce6f8f]' : 'text-[#8a8fad]'}`}>
          {fmt(cat.spentDollars)} / {fmt(cat.budgetedDollars)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-[#2a2b45] overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${barPct}%`, backgroundColor: barColor }}
        />
      </div>

      <div className="flex items-center justify-between mt-1">
        {cat.pctUsed !== null && (
          <span className="text-[10px] text-[#8a8fad]">{cat.pctUsed}% used</span>
        )}
        <span className={`text-[10px] tabular-nums ml-auto ${isOver ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'}`}>
          {isOver
            ? `+${fmt(cat.projectedOverspendDollars)} over by month-end`
            : `${fmt(-cat.projectedOverspendDollars)} projected remaining`}
        </span>
      </div>
    </div>
  )
}
