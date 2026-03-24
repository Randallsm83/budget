'use client'

import { useState, useTransition } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// Renders plain-text AI responses: strips stray markdown symbols,
// splits on newlines, and renders numbered/bulleted list items distinctly.
function ProseContent({ text }: { text: string }) {
  // Strip common markdown artifacts the model sneaks in despite instructions
  const clean = text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold** → plain
    .replace(/\*(.+?)\*/g, '$1')        // *italic* → plain
    .replace(/^#{1,3}\s+/gm, '')        // ## heading → plain
    .replace(/^---+$/gm, '')            // horizontal rules
    .replace(/^[\-\*]\s+/gm, '• ')     // - bullet → •

  const lines = clean.split('\n').filter((l) => l.trim() !== '')

  return (
    <span className="block space-y-1">
      {lines.map((line, i) => (
        <span key={i} className="block leading-relaxed">{line}</span>
      ))}
    </span>
  )
}

export function AIAssistantPanel({ month }: { month: string }) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function send() {
    const text = input.trim()
    if (!text) return
    setInput('')
    setError('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])

    startTransition(async () => {
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, month, conversationId }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'AI chat failed')
        if (data.conversationId) setConversationId(data.conversationId)
        setMessages((prev) => [...prev, { role: 'assistant', content: data.message ?? 'No response.' }])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'AI chat failed')
      }
    })
  }

  return (
    <div className="border border-[#3a3b58] rounded-lg bg-[#1f2039] p-3 sm:p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs sm:text-sm font-semibold text-[#b3a1e6] uppercase tracking-wider">Budget Coach</h3>
        <span className="text-[10px] text-[#8a8fad]">{month}</span>
      </div>
      <div className="max-h-48 overflow-auto space-y-2 mb-3">
        {messages.length === 0 && (
          <p className="text-xs text-[#8a8fad]">Ask: “Why is my RTA this amount?”, “What should I fund first?”, or “How can I reduce debt faster?”</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`text-xs rounded px-2 py-1 ${m.role === 'user' ? 'bg-[#2a2b45] text-[#ecf0f1]' : 'bg-[#1a1b2e] text-[#c5cae9]'}`}>
            <span className="font-semibold mr-1">{m.role === 'user' ? 'You:' : 'Coach:'}</span>
            {m.role === 'assistant' ? <ProseContent text={m.content} /> : m.content}
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-[#ce6f8f] mb-2">{error}</p>}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          placeholder="Ask Budget Coach..."
          className="flex-1 bg-[#2a2b45] border border-[#3a3b58] text-[#ecf0f1] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#b3a1e6]"
        />
        <button
          onClick={send}
          disabled={isPending}
          className="px-3 py-1.5 text-sm rounded bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold disabled:opacity-50"
        >
          {isPending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
