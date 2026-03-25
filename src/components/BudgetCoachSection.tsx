'use client'

import { useState } from 'react'
import { BudgetInsightsCard } from '@/components/BudgetInsightsCard'
import { AIAssistantPanel } from '@/components/AIAssistantPanel'
import { SpendingForecastCard } from '@/components/SpendingForecastCard'

export function BudgetCoachSection({ month }: { month: string }) {
  const [pendingMessage, setPendingMessage] = useState<string | undefined>(undefined)

  return (
    <div className="flex-shrink-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 px-4 sm:px-6 py-4 border-t border-[#3a3b58]">
      <SpendingForecastCard month={month} />
      <BudgetInsightsCard
        month={month}
        onExplain={(query) => setPendingMessage(query)}
      />
      <AIAssistantPanel
        month={month}
        pendingMessage={pendingMessage}
        onPendingMessageConsumed={() => setPendingMessage(undefined)}
      />
    </div>
  )
}
