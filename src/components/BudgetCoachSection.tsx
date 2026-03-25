'use client'

import { useState } from 'react'
import { BudgetInsightsCard } from '@/components/BudgetInsightsCard'
import { AIAssistantPanel } from '@/components/AIAssistantPanel'
import { SpendingForecastCard } from '@/components/SpendingForecastCard'

const COLLAPSED_KEY = 'budget-coach-collapsed'

export function BudgetCoachSection({ month }: { month: string }) {
  const [pendingMessage, setPendingMessage] = useState<string | undefined>(undefined)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === 'true' } catch { return false }
  })

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem(COLLAPSED_KEY, String(next)) } catch {}
      return next
    })
  }

  return (
    <div className="flex-shrink-0 border-t border-[#3a3b58]">
      {/* Collapse toggle bar */}
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 sm:px-6 py-2
                   text-xs text-[#5a5b78] hover:text-[#b3a1e6] hover:bg-[#1f2039]
                   transition-colors group"
      >
        <span className="font-semibold uppercase tracking-wider group-hover:text-[#b3a1e6]">
          AI Coach
        </span>
        <span className="text-[10px]">{collapsed ? '▸ Show' : '▾ Hide'}</span>
      </button>

      {/* Panels — fixed height so the section never changes size */}
      {!collapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 px-4 sm:px-6 pb-4">
          <div className="h-64 overflow-auto">
            <SpendingForecastCard month={month} />
          </div>
          <div className="h-64 overflow-auto">
            <BudgetInsightsCard
              month={month}
              onExplain={(query) => setPendingMessage(query)}
            />
          </div>
          <div className="h-64">
            <AIAssistantPanel
              month={month}
              pendingMessage={pendingMessage}
              onPendingMessageConsumed={() => setPendingMessage(undefined)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
