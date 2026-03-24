'use client'

import { useEffect, useState } from 'react'

interface Insight {
  title: string
  summary: string
  action: string
  confidence: number
}

interface Props {
  month: string
  onExplain?: (query: string) => void
}

export function BudgetInsightsCard({ month, onExplain }: Props) {
  const [insights, setInsights] = useState<Insight[]>([])
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ai/insights/monthly', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load insights')
        if (!cancelled) setInsights((data.insights ?? []) as Insight[])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load insights')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [month])

  const visible = insights.filter((_, i) => !dismissed.has(i))

  return (
    <div className="border border-[#3a3b58] rounded-lg bg-[#1f2039] p-3 sm:p-4">
      <h3 className="text-xs sm:text-sm font-semibold text-[#5ccc96] uppercase tracking-wider mb-2">AI Monthly Insights</h3>
      {loading && <p className="text-xs text-[#8a8fad]">Generating insights…</p>}
      {error && <p className="text-xs text-[#ce6f8f]">{error}</p>}
      {!loading && !error && visible.length === 0 && (
        <p className="text-xs text-[#8a8fad]">No insights available yet.</p>
      )}
      <div className="space-y-2">
        {insights.map((ins, idx) => {
          if (dismissed.has(idx)) return null
          return (
            <div key={idx} className="bg-[#1a1b2e] rounded p-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-[#ecf0f1] font-semibold leading-snug">{ins.title}</p>
                <button
                  onClick={() => setDismissed((prev) => new Set([...prev, idx]))}
                  className="text-[#8a8fad] hover:text-[#ce6f8f] text-xs shrink-0 mt-0.5"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-[#8a8fad] mt-0.5">{ins.summary}</p>
              <p className="text-xs text-[#b3a1e6] mt-1">{ins.action}</p>
              {onExplain && (
                <button
                  onClick={() => onExplain(`Explain more about this insight: "${ins.title}". ${ins.summary}`)}
                  className="mt-1.5 text-[10px] text-[#8a8fad] hover:text-[#b3a1e6] border border-[#3a3b58] hover:border-[#b3a1e6] rounded px-2 py-0.5 transition-colors"
                >
                  Explain more
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
