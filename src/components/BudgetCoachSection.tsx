'use client'

import { useState } from 'react'
import { BudgetInsightsCard } from '@/components/BudgetInsightsCard'
import { AIAssistantPanel } from '@/components/AIAssistantPanel'

export function BudgetCoachSection({ month }: { month: string }) {
  const [pendingMessage, setPendingMessage] = useState<string | undefined>(undefined)

  return (
    <div className="flex-shrink-0 grid grid-cols-1 lg:grid-cols-2 gap-3 px-4 sm:px-6 py-4 border-t border-[#3a3b58]">
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
