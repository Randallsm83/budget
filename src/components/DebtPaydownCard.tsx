'use client'

import { useState, useTransition } from 'react'
import { formatMoney, parseMoney } from '@/lib/budget'

interface DebtPlan {
  method: 'snowball' | 'avalanche'
  monthlyPayment: number
  projectedMonths: number
  totalInterestEstimate: number
  assumptions: string[]
  steps: string[]
}

export function DebtPaydownCard({ month }: { month: string }) {
  const [method, setMethod] = useState<'snowball' | 'avalanche'>('avalanche')
  const [payment, setPayment] = useState('300.00')
  const [plan, setPlan] = useState<DebtPlan | null>(null)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function generate() {
    setError('')
    startTransition(async () => {
      try {
        const monthlyPayment = parseMoney(payment)
        const res = await fetch('/api/ai/debt-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month, method, monthlyPayment }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not generate debt plan')
        setPlan(data.plan as DebtPlan)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not generate debt plan')
      }
    })
  }

  return (
    <div className="border border-[#3a3b58] rounded-lg bg-[#1f2039] p-3 sm:p-4">
      <h3 className="text-xs sm:text-sm font-semibold text-[#e5c07b] uppercase tracking-wider mb-2">AI Debt Paydown</h3>
      <div className="flex gap-2 mb-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as 'snowball' | 'avalanche')}
          className="bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded px-2 py-1 text-sm"
        >
          <option value="avalanche">Avalanche</option>
          <option value="snowball">Snowball</option>
        </select>
        <input
          value={payment}
          onChange={(e) => setPayment(e.target.value)}
          placeholder="Extra monthly payment"
          className="flex-1 bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded px-2 py-1 text-sm"
        />
        <button
          onClick={generate}
          disabled={isPending}
          className="px-3 py-1 text-sm rounded bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold disabled:opacity-50"
        >
          {isPending ? '...' : 'Plan'}
        </button>
      </div>
      {error && <p className="text-xs text-[#ce6f8f]">{error}</p>}
      {plan && (
        <div className="text-xs text-[#c5cae9] space-y-1">
          <p><span className="text-[#8a8fad]">Method:</span> {plan.method}</p>
          <p><span className="text-[#8a8fad]">Projected timeline:</span> {plan.projectedMonths} months</p>
          <p><span className="text-[#8a8fad]">Estimated interest:</span> {formatMoney(plan.totalInterestEstimate)}</p>
          <div className="mt-1">
            <p className="text-[#8a8fad]">Next steps:</p>
            <ul className="list-disc ml-4">
              {plan.steps.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
