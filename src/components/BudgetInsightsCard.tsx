'use client'

import { useEffect, useState } from 'react'

interface Insight {
  title: string
  summary: string
  action: string
  confidence: number
}

export function BudgetInsightsCard({ month }: { month: string }) {
  const [insights, setInsights] = useState<Insight[]>([])
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

  return (
    <div className="border border-[#3a3b58] rounded-lg bg-[#1f2039] p-3 sm:p-4">
      <h3 className="text-xs sm:text-sm font-semibold text-[#5ccc96] uppercase tracking-wider mb-2">AI Monthly Insights</h3>
      {loading && <p className="text-xs text-[#8a8fad]">Generating insights…</p>}
      {error && <p className="text-xs text-[#ce6f8f]">{error}</p>}
      {!loading && !error && insights.length === 0 && (
        <p className="text-xs text-[#8a8fad]">No insights available yet.</p>
      )}
      <div className="space-y-2">
        {insights.map((i, idx) => (
          <div key={idx} className="bg-[#1a1b2e] rounded p-2">
            <p className="text-sm text-[#ecf0f1] font-semibold">{i.title}</p>
            <p className="text-xs text-[#8a8fad] mt-0.5">{i.summary}</p>
            <p className="text-xs text-[#b3a1e6] mt-1">Action: {i.action}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
