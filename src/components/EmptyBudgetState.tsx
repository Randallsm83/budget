'use client'

import { useState } from 'react'
import { AddAccountModal } from './AddAccountModal'

export function EmptyBudgetState() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="text-5xl opacity-40">🏦</div>
        <h2 className="text-xl font-semibold text-[#ecf0f1]">No accounts yet</h2>
        <p className="text-sm text-[#8a8fad] max-w-xs">
          Add a bank account to start budgeting. Connect via Plaid for automatic transaction
          import, or add one manually.
        </p>
      </div>
      <button
        onClick={() => setOpen(true)}
        className="bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
      >
        + Add your first account
      </button>
      {open && <AddAccountModal onClose={() => setOpen(false)} />}
    </div>
  )
}
