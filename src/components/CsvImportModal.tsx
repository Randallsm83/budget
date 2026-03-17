'use client'

import { useState, useTransition } from 'react'
import { importTransactions, type CsvRow } from '@/lib/actions'
import { formatMoney } from '@/lib/budget'

interface Props {
  accountId: string
  categories: { id: string; name: string; groupName: string }[]
  onClose: () => void
}

// ---------------------------------------------------------------------------
// CSV parsing helpers (no external libs)
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur.trim())
  return result
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseCsvLine)
}

// Normalise various date formats to YYYY-MM-DD
function normaliseDate(raw: string): string | null {
  const s = raw.replace(/"/g, '').trim()
  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(s)) return s.replace(/\//g, '-')
  // MM/DD/YYYY or MM-DD-YYYY
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`
  // DD/MM/YYYY with 4-digit year check — ambiguous but common outside US
  // Fallback: try Date.parse
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10)
  return null
}

function parseAmount(raw: string): number | null {
  const s = raw.replace(/[$,"\s]/g, '')
  const n = parseFloat(s)
  if (isNaN(n)) return null
  return Math.round(n * 1000)
}

function isDateLike(values: string[]): boolean {
  const sample = values.slice(0, 10).filter(Boolean)
  return sample.filter((v) => normaliseDate(v) !== null).length >= Math.ceil(sample.length * 0.6)
}

function isAmountLike(values: string[]): boolean {
  const sample = values.slice(0, 10).filter(Boolean)
  return sample.filter((v) => parseAmount(v) !== null).length >= Math.ceil(sample.length * 0.6)
}

// Simple hash for dedup importId
function hashRow(date: string, payee: string, amount: number): string {
  const s = `${date}|${payee}|${amount}`
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return `csv_${Math.abs(h).toString(36)}_${s.length}`
}

interface DetectedRow {
  index: number
  date: string
  payee: string
  amount: number // milliunits
  selected: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Step = 'upload' | 'map' | 'preview' | 'done'

export function CsvImportModal({ accountId, onClose }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [isPending, startTransition] = useTransition()

  // Parsed raw data
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<string[][]>([])

  // Column mapping
  const [dateCol, setDateCol] = useState<number>(-1)
  const [payeeCol, setPayeeCol] = useState<number>(-1)
  const [amountCol, setAmountCol] = useState<number>(-1)
  const [debitCol, setDebitCol] = useState<number>(-1)  // separate debit column
  const [creditCol, setCreditCol] = useState<number>(-1) // separate credit column
  const [memoCol, setMemoCol] = useState<number>(-1)
  const [useSeparateColumns, setUseSeparateColumns] = useState(false)

  // Preview rows
  const [rows, setRows] = useState<DetectedRow[]>([])
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [error, setError] = useState('')

  // ---------------------------------------------------------------------------
  // Step 1: file upload + auto-detect
  // ---------------------------------------------------------------------------
  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parseCsv(text)
      if (parsed.length < 2) { setError('File appears empty or invalid.'); return }

      const hdrs = parsed[0]
      const data = parsed.slice(1)
      setHeaders(hdrs)
      setRawRows(data)

      // Auto-detect columns
      let dCol = -1, pCol = -1, aCol = -1, mCol = -1
      const colValues = hdrs.map((_, ci) => data.map((r) => r[ci] ?? ''))

      for (let ci = 0; ci < hdrs.length; ci++) {
        const hLower = hdrs[ci].toLowerCase()
        if (dCol === -1 && (hLower.includes('date') || isDateLike(colValues[ci]))) dCol = ci
        if (aCol === -1 && (hLower.includes('amount') || hLower.includes('amt'))) aCol = ci
        if (pCol === -1 && (hLower.includes('payee') || hLower.includes('description') || hLower.includes('desc') || hLower.includes('merchant') || hLower.includes('name'))) pCol = ci
        if (mCol === -1 && (hLower.includes('memo') || hLower.includes('note'))) mCol = ci
      }
      // Fallback: find amount by values if header didn't match
      if (aCol === -1) {
        for (let ci = 0; ci < hdrs.length; ci++) {
          if (ci !== dCol && isAmountLike(colValues[ci])) { aCol = ci; break }
        }
      }
      // Fallback payee: longest text column that isn't date/amount
      if (pCol === -1) {
        let maxAvg = 0
        for (let ci = 0; ci < hdrs.length; ci++) {
          if (ci === dCol || ci === aCol || ci === mCol) continue
          const avg = colValues[ci].reduce((s, v) => s + v.length, 0) / (colValues[ci].length || 1)
          if (avg > maxAvg) { maxAvg = avg; pCol = ci }
        }
      }

      setDateCol(dCol)
      setPayeeCol(pCol)
      setAmountCol(aCol)
      setMemoCol(mCol)
      setStep('map')
      setError('')
    }
    reader.readAsText(file)
  }

  // ---------------------------------------------------------------------------
  // Step 2: confirm mapping → build preview
  // ---------------------------------------------------------------------------
  function buildPreview() {
    const detected: DetectedRow[] = []
    rawRows.forEach((row, i) => {
      const rawDate = row[dateCol] ?? ''
      const date = normaliseDate(rawDate)
      if (!date) return

      let amount: number | null = null
      if (useSeparateColumns) {
        const debit = debitCol >= 0 ? parseAmount(row[debitCol] ?? '') : null
        const credit = creditCol >= 0 ? parseAmount(row[creditCol] ?? '') : null
        if (debit != null && debit !== 0) amount = -Math.abs(debit)
        else if (credit != null && credit !== 0) amount = Math.abs(credit)
        else amount = 0
      } else {
        amount = amountCol >= 0 ? parseAmount(row[amountCol] ?? '') : null
      }
      if (amount === null) return

      const payee = payeeCol >= 0 ? (row[payeeCol] ?? '').replace(/"/g, '').trim() : ''
      const memo = memoCol >= 0 ? (row[memoCol] ?? '').replace(/"/g, '').trim() : ''

      detected.push({ index: i, date, payee, amount, selected: true })
      void memo // stored via closure in submit
    })

    if (detected.length === 0) {
      setError('No valid rows found with the selected columns. Check your mapping.')
      return
    }
    setRows(detected)
    setStep('preview')
    setError('')
  }

  // ---------------------------------------------------------------------------
  // Step 3: submit
  // ---------------------------------------------------------------------------
  function handleImport() {
    const selected = rows.filter((r) => r.selected)
    if (selected.length === 0) { setError('Select at least one row.'); return }

    const csvRows: CsvRow[] = selected.map((r) => ({
      date: r.date,
      payee: r.payee,
      amount: r.amount,
      memo: memoCol >= 0 ? (rawRows[r.index]?.[memoCol] ?? '').trim() : undefined,
      importId: hashRow(r.date, r.payee, r.amount),
    }))

    startTransition(async () => {
      try {
        const res = await importTransactions(accountId, csvRows)
        setResult(res)
        setStep('done')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Import failed.')
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#1f2039] border border-[#3a3b58] rounded-xl w-full max-w-2xl mx-4 p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-5 flex-shrink-0">
          <h2 className="text-lg font-semibold text-[#ecf0f1]">Import CSV</h2>
          <button onClick={onClose} className="text-[#8a8fad] hover:text-[#ecf0f1] text-lg">✕</button>
        </div>

        {error && (
          <p className="text-sm text-[#ce6f8f] bg-[#ce6f8f]/10 border border-[#ce6f8f]/20 rounded-lg px-3 py-2 mb-4 flex-shrink-0">
            {error}
          </p>
        )}

        {/* ── Step 1: Upload ── */}
        {step === 'upload' && (
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#3a3b58]
                            hover:border-[#b3a1e6] rounded-xl p-12 cursor-pointer transition-colors">
            <span className="text-4xl mb-3">📂</span>
            <p className="text-[#ecf0f1] font-medium mb-1">Click to choose a CSV file</p>
            <p className="text-xs text-[#8a8fad]">Standard bank export formats supported</p>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
          </label>
        )}

        {/* ── Step 2: Column mapping ── */}
        {step === 'map' && (
          <div className="flex flex-col gap-4 overflow-y-auto">
            <p className="text-xs text-[#8a8fad]">
              Detected {rawRows.length} data rows. Confirm or adjust column mapping.
            </p>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Date column *', value: dateCol, set: setDateCol },
                { label: 'Payee column *', value: payeeCol, set: setPayeeCol },
                { label: 'Memo column', value: memoCol, set: setMemoCol },
              ].map(({ label, value, set }) => (
                <div key={label}>
                  <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
                    {label}
                  </label>
                  <select
                    value={value}
                    onChange={(e) => set(Number(e.target.value))}
                    className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                               focus:outline-none focus:border-[#b3a1e6]"
                  >
                    <option value={-1}>— none —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
              ))}

              <div className="col-span-2">
                <label className="flex items-center gap-2 text-xs text-[#8a8fad] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useSeparateColumns}
                    onChange={(e) => setUseSeparateColumns(e.target.checked)}
                    className="accent-[#b3a1e6]"
                  />
                  Bank uses separate Debit / Credit columns
                </label>
              </div>

              {useSeparateColumns ? (
                <>
                  {[
                    { label: 'Debit column (outflow)', value: debitCol, set: setDebitCol },
                    { label: 'Credit column (inflow)', value: creditCol, set: setCreditCol },
                  ].map(({ label, value, set }) => (
                    <div key={label}>
                      <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">{label}</label>
                      <select
                        value={value}
                        onChange={(e) => set(Number(e.target.value))}
                        className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                                   focus:outline-none focus:border-[#b3a1e6]"
                      >
                        <option value={-1}>— none —</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-[#8a8fad] mb-1.5 uppercase tracking-wide">
                    Amount column * <span className="normal-case text-[#3a3b58]">(negative = outflow)</span>
                  </label>
                  <select
                    value={amountCol}
                    onChange={(e) => setAmountCol(Number(e.target.value))}
                    className="w-full bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3 py-2 text-sm
                               focus:outline-none focus:border-[#b3a1e6]"
                  >
                    <option value={-1}>— none —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Preview first 3 raw rows */}
            <div className="overflow-x-auto rounded-lg border border-[#3a3b58]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#252640]">
                    {headers.map((h, i) => (
                      <th key={i} className="px-2 py-1.5 text-left text-[#8a8fad] font-semibold whitespace-nowrap">
                        {h || `Col ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawRows.slice(0, 3).map((row, ri) => (
                    <tr key={ri} className="border-t border-[#1f2039]">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-2 py-1 text-[#ecf0f1] truncate max-w-[8rem]">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 pt-1 flex-shrink-0">
              <button
                onClick={() => { setStep('upload'); setError('') }}
                className="flex-1 bg-[#2a2b45] hover:bg-[#3a3b58] text-[#8a8fad] font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Back
              </button>
              <button
                onClick={buildPreview}
                disabled={dateCol < 0 || payeeCol < 0 || (!useSeparateColumns && amountCol < 0)}
                className="flex-1 bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold py-2 rounded-lg text-sm
                           transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Preview →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Preview + select ── */}
        {step === 'preview' && (
          <div className="flex flex-col gap-3 min-h-0">
            <div className="flex items-center justify-between flex-shrink-0">
              <p className="text-xs text-[#8a8fad]">
                {rows.filter((r) => r.selected).length} of {rows.length} rows selected
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setRows((r) => r.map((x) => ({ ...x, selected: true })))}
                  className="text-xs text-[#8a8fad] hover:text-[#ecf0f1]"
                >
                  All
                </button>
                <button
                  onClick={() => setRows((r) => r.map((x) => ({ ...x, selected: false })))}
                  className="text-xs text-[#8a8fad] hover:text-[#ecf0f1]"
                >
                  None
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 rounded-lg border border-[#3a3b58]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#252640]">
                  <tr>
                    <th className="px-2 py-1.5 w-6" />
                    <th className="px-2 py-1.5 text-left text-[#8a8fad] font-semibold">Date</th>
                    <th className="px-2 py-1.5 text-left text-[#8a8fad] font-semibold">Payee</th>
                    <th className="px-2 py-1.5 text-right text-[#8a8fad] font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={i}
                      className={`border-t border-[#1f2039] cursor-pointer transition-colors
                                  ${row.selected ? 'hover:bg-[#1f2039]' : 'opacity-40 hover:opacity-60'}`}
                      onClick={() => setRows((prev) => prev.map((r, j) => j === i ? { ...r, selected: !r.selected } : r))}
                    >
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={row.selected} readOnly className="accent-[#b3a1e6]" />
                      </td>
                      <td className="px-2 py-1.5 text-[#8a8fad] tabular-nums whitespace-nowrap">{row.date}</td>
                      <td className="px-2 py-1.5 text-[#ecf0f1] max-w-[16rem] truncate">{row.payee || '—'}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${row.amount < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'}`}>
                        {formatMoney(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 pt-1 flex-shrink-0">
              <button
                onClick={() => { setStep('map'); setError('') }}
                className="flex-1 bg-[#2a2b45] hover:bg-[#3a3b58] text-[#8a8fad] font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={isPending || rows.filter((r) => r.selected).length === 0}
                className="flex-1 bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold py-2 rounded-lg text-sm
                           transition-colors disabled:opacity-50"
              >
                {isPending ? 'Importing…' : `Import ${rows.filter((r) => r.selected).length} transactions`}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Done ── */}
        {step === 'done' && result && (
          <div className="flex flex-col items-center gap-4 py-8">
            <span className="text-5xl">✅</span>
            <p className="text-[#ecf0f1] font-semibold text-lg">Import complete</p>
            <div className="text-sm text-[#8a8fad] text-center space-y-1">
              <p><span className="text-[#5ccc96] font-semibold">{result.imported}</span> transactions imported</p>
              {result.skipped > 0 && (
                <p><span className="text-[#f2ce00] font-semibold">{result.skipped}</span> duplicates skipped</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold px-6 py-2 rounded-lg text-sm transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
