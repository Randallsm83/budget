'use client'

import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, Suspense } from 'react'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/budget'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError('Invalid email or password.')
      return
    }

    if (data.mfaRequired) {
      setStep('totp')
    } else {
      await completeSignIn()
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    await completeSignIn(totpCode)
  }

  async function completeSignIn(code?: string) {
    const result = await signIn('credentials', {
      email,
      password,
      totpCode: code ?? '',
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setError(step === 'totp' ? 'Invalid authenticator code.' : 'Invalid email or password.')
    } else {
      router.push(callbackUrl)
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen bg-[#1a1b2e] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / title */}
        <div className="mb-8 text-center">
          <Image src="/logo.svg" alt="Budget" width={56} height={56} className="mx-auto mb-4" unoptimized />
          <h1 className="text-2xl font-bold text-[#ecf0f1]">Budget</h1>
          <p className="text-sm text-[#8a8fad] mt-1">Sign in to your account</p>
        </div>

        {step === 'credentials' ? (
          <form onSubmit={handleCredentials} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#8a8fad] mb-1.5">Email</label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#1f2039] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3.5 py-2.5 text-sm
                           focus:outline-none focus:border-[#b3a1e6] focus:ring-1 focus:ring-[#b3a1e6] transition-colors
                           placeholder:text-[#3a3b58]"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#8a8fad] mb-1.5">Password</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#1f2039] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3.5 py-2.5 text-sm
                           focus:outline-none focus:border-[#b3a1e6] focus:ring-1 focus:ring-[#b3a1e6] transition-colors
                           placeholder:text-[#3a3b58]"
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p className="text-sm text-[#ce6f8f] bg-[#ce6f8f]/10 border border-[#ce6f8f]/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold py-2.5 rounded-lg text-sm
                         transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? 'Checking…' : 'Continue'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleTotp} className="space-y-4">
            <p className="text-sm text-[#8a8fad]">
              Enter the 6-digit code from your authenticator app.
            </p>
            <div>
              <label className="block text-sm font-medium text-[#8a8fad] mb-1.5">Authenticator code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                className="w-full bg-[#1f2039] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3.5 py-2.5 text-sm
                           focus:outline-none focus:border-[#b3a1e6] focus:ring-1 focus:ring-[#b3a1e6] transition-colors
                           tracking-[0.4em] text-center font-mono text-lg"
                placeholder="000000"
              />
            </div>
            {error && (
              <p className="text-sm text-[#ce6f8f] bg-[#ce6f8f]/10 border border-[#ce6f8f]/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || totpCode.length !== 6}
              className="w-full bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold py-2.5 rounded-lg text-sm
                         transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? 'Verifying…' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('credentials'); setError(''); setTotpCode('') }}
              className="w-full text-xs text-[#8a8fad] hover:text-[#ecf0f1] transition-colors"
            >
              ← Back
            </button>
          </form>
        )}

        <p className="text-xs text-[#3a3b58] text-center mt-6">
          Invite-only — contact the owner to get access.
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
