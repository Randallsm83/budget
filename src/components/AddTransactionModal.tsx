'use client'

import { useState, useTransition } from 'react'
import { addTransaction, updateTransaction } from '@/lib/actions'

interface CategoryOption {
  id: string
  name: string
  groupName: string
  isIncome: boolean
}

interface AccountOption {
  id: string
  name: string
}

interface InitialValues {
  id: string
  accountId: string
  categoryId: string | null
  date: string
  payee: string
  amount: number // milliunits — negative = outflow
  memo: string
}

interface Props {
  accounts: AccountOption[]
  categories: CategoryOption[]
  defaultAccountId?: string
  initialValues?: InitialValues
  onClose: () => void
}

export function AddTransactionModal({ accounts, categories, defaultAccountId, initialValues, onClose }: Props) {
  const today = new Date().toISOString().substring(0, 10)
  const isEditing = !!initialValues

  const initOutflow = initialValues ? initialValues.amount < 0 : true
  const initAmount = initialValues
    ? (Math.abs(initialValues.amount) / 1000).toFixed(2)
    : ''

  const [accountId, setAccountId] = useState(initialValues?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? '')
  const initCat = initialValues?.categoryId ?? ''
  const initIsIncome = categories.find((c) => c.id === initCat)?.isIncome ?? false
  const [categoryId, setCategoryId] = useState(initCat)
  const [date, setDate] = useState(initialValues?.date ?? today)
  const [payee, setPayee] = useState(initialValues?.payee ?? '')
  const [amount, setAmount] = useState(initAmount)
  const [isOutflow, setIsOutflow] = useState(initOutflow && !initIsIncome)
  const [memo, setMemo] = useState(initialValues?.memo ?? '')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!accountId) return setError('Select an account.')
    if (!amount || isNaN(parseFloat(amount))) return setError('Enter a valid amount.')
    if (!date) return setError('Date is required.')
    setError('')

    startTransition(async () => {
      try {
        if (isEditing && initialValues) {
          await updateTransaction(initialValues.id, {
            accountId,
            categoryId: categoryId || null,
            date,
            payee,
            amountDollars: amount,
            isOutflow,
            memo,
          })
        } else {
          await addTransaction({
            accountId,
            categoryId: categoryId || null,
            date,
            payee,
            amountDollars: amount,
            isOutflow,
            memo,
          })
        }
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save transaction.')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#1f2039] border border-[#3a3b58] rounded-xl w-full max-w-md mx-4 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-[#ecf0f1] mb-5">
          {isEditing ? 'Edit Transaction' : 'Add Transaction'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Account */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
                Account
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:border-[#b3a1e6] transition-colors"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:border-[#b3a1e6] transition-colors"
              />
            </div>
          </div>

          {/* Payee */}
          <div>
            <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
              Payee
            </label>
            <input
              type="text"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="Who did you pay?"
              className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-[#b3a1e6] transition-colors"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
              Category
            </label>
            <select
              value={categoryId}
              onChange={(e) => {
                const cat = categories.find((c) => c.id === e.target.value)
                setCategoryId(e.target.value)
                if (cat) setIsOutflow(!cat.isIncome)
              }}
              className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-[#b3a1e6] transition-colors"
            >
              <option value="">— Inflow / Ready to Assign —</option>
              {categories.some((c) => c.isIncome) && (
                <optgroup label="— Income —">
                  {categories.filter((c) => c.isIncome).map((c) => (
                    <option key={c.id} value={c.id}>{c.groupName}: {c.name}</option>
                  ))}
                </optgroup>
              )}
              {categories.some((c) => !c.isIncome) && (
                <optgroup label="— Expenses —">
                  {categories.filter((c) => !c.isIncome).map((c) => (
                    <option key={c.id} value={c.id}>{c.groupName}: {c.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Amount + direction */}
          <div>
            <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
              Amount ($)
            </label>
            <div className="flex gap-2">
              {/* Outflow / Inflow toggle */}
              <div className="flex rounded-lg overflow-hidden border border-[#3a3b58] text-sm flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setIsOutflow(true)}
                  className={`px-3 py-2 transition-colors ${
                    isOutflow
                      ? 'bg-[#ce6f8f] text-white font-semibold'
                      : 'bg-[#2a2b45] text-[#8a8fad] hover:text-[#ecf0f1]'
                  }`}
                >
                  Out
                </button>
                <button
                  type="button"
                  onClick={() => setIsOutflow(false)}
                  className={`px-3 py-2 transition-colors ${
                    !isOutflow
                      ? 'bg-[#5ccc96] text-[#1a1b2e] font-semibold'
                      : 'bg-[#2a2b45] text-[#8a8fad] hover:text-[#ecf0f1]'
                  }`}
                >
                  In
                </button>
              </div>
              <input
                type="text"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onFocus={(e) => e.target.select()}
                placeholder="0.00"
                className="flex-1 bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:border-[#b3a1e6] transition-colors tabular-nums text-right"
              />
            </div>
          </div>

          {/* Memo */}
          <div>
            <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
              Memo <span className="normal-case text-[#3a3b58]">(optional)</span>
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-[#b3a1e6] transition-colors"
            />
          </div>

          {error && (
            <p className="text-sm text-[#ce6f8f] bg-[#ce6f8f]/10 border border-[#ce6f8f]/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-[#2a2b45] hover:bg-[#3a3b58] text-[#8a8fad] font-medium py-2 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold py-2 rounded-lg text-sm
                         transition-colors disabled:opacity-60"
            >
              {isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
