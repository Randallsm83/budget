'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useAdminMode } from '@/lib/admin-mode'

export default function SecuritySettingsPage() {
  const router = useRouter()
  const [adminMode, toggleAdminMode] = useAdminMode()
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Setup flow state
  const [setupStep, setSetupStep] = useState<'idle' | 'scan' | 'verify' | 'disable' | 'delete-confirm'>('idle')
  const [secret, setSecret] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [code, setCode] = useState('')

  useEffect(() => {
    fetch('/api/auth/mfa/status')
      .then((r) => r.json())
      .then((d) => setMfaEnabled(d.enabled))
      .catch(() => setMfaEnabled(false))
  }, [])

  async function startSetup() {
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/mfa/setup', { method: 'POST' })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    setSecret(data.secret)
    setQrCodeDataUrl(data.qrCodeDataUrl)
    setSetupStep('scan')
  }

  async function enableMfa(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/mfa/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, code }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    setMfaEnabled(true)
    setSetupStep('idle')
    setCode('')
    setSuccess('Authenticator app enabled successfully.')
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/mfa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    setMfaEnabled(false)
    setSetupStep('idle')
    setCode('')
    setSuccess('Authenticator app removed.')
  }

  const inputCls = `w-full bg-[#1f2039] border border-[#3a3b58] text-[#ecf0f1] rounded-lg px-3.5 py-2.5 text-sm
    focus:outline-none focus:border-[#b3a1e6] focus:ring-1 focus:ring-[#b3a1e6] transition-colors`

  return (
    <div className="max-w-lg mx-auto px-6 py-10">
      <button
        onClick={() => router.back()}
        className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] transition-colors mb-6 flex items-center gap-1"
      >
        ← Back
      </button>

      <h1 className="text-xl font-bold text-[#ecf0f1] mb-1">Security</h1>
      <p className="text-sm text-[#8a8fad] mb-8">Manage two-factor authentication for your account.</p>

      {success && (
        <p className="text-sm text-[#5ccc96] bg-[#5ccc96]/10 border border-[#5ccc96]/20 rounded-lg px-3 py-2 mb-6">
          {success}
        </p>
      )}

      <div className="bg-[#1f2039] border border-[#3a3b58] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-medium text-[#ecf0f1]">Authenticator App (TOTP)</p>
            <p className="text-xs text-[#8a8fad] mt-0.5">
              Use an app like 1Password, Google Authenticator, or Authy.
            </p>
          </div>
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${
              mfaEnabled
                ? 'bg-[#5ccc96]/15 text-[#5ccc96]'
                : 'bg-[#3a3b58] text-[#8a8fad]'
            }`}
          >
            {mfaEnabled === null ? '…' : mfaEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        {setupStep === 'idle' && (
          <>
            {!mfaEnabled ? (
              <button
                onClick={startSetup}
                disabled={loading}
                className="w-full bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold py-2 rounded-lg text-sm
                           transition-colors disabled:opacity-60"
              >
                {loading ? 'Loading…' : 'Set up authenticator app'}
              </button>
            ) : (
              <button
                onClick={() => { setSetupStep('disable'); setError(''); setCode('') }}
                className="w-full border border-[#ce6f8f] text-[#ce6f8f] hover:bg-[#ce6f8f]/10 font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Remove authenticator app
              </button>
            )}
          </>
        )}

        {setupStep === 'scan' && (
          <div className="space-y-4">
            <p className="text-sm text-[#8a8fad]">
              Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
            </p>
            {qrCodeDataUrl && (
              <div className="flex justify-center bg-white rounded-lg p-3 w-fit mx-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrCodeDataUrl} alt="MFA QR Code" width={180} height={180} />
              </div>
            )}
            <details className="text-xs">
              <summary className="text-[#8a8fad] cursor-pointer hover:text-[#ecf0f1]">
                Can&apos;t scan? Enter manually
              </summary>
              <p className="mt-2 font-mono text-[#ecf0f1] bg-[#16172a] rounded px-3 py-2 break-all select-all">
                {secret}
              </p>
            </details>
            <form onSubmit={enableMfa} className="space-y-3">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className={`${inputCls} tracking-[0.4em] text-center font-mono text-lg`}
                placeholder="000000"
              />
              {error && (
                <p className="text-sm text-[#ce6f8f]">{error}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setSetupStep('idle'); setError(''); setCode('') }}
                  className="flex-1 border border-[#3a3b58] text-[#8a8fad] hover:text-[#ecf0f1] font-medium py-2 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="flex-1 bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e] font-semibold py-2 rounded-lg text-sm
                             transition-colors disabled:opacity-60"
                >
                  {loading ? 'Verifying…' : 'Enable'}
                </button>
              </div>
            </form>
          </div>
        )}

        {setupStep === 'disable' && (
          <form onSubmit={disableMfa} className="space-y-3">
            <p className="text-sm text-[#8a8fad]">
              Enter your current authenticator code to confirm removal.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={`${inputCls} tracking-[0.4em] text-center font-mono text-lg`}
              placeholder="000000"
            />
            {error && <p className="text-sm text-[#ce6f8f]">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setSetupStep('idle'); setError(''); setCode('') }}
                className="flex-1 border border-[#3a3b58] text-[#8a8fad] hover:text-[#ecf0f1] font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="flex-1 border border-[#ce6f8f] text-[#ce6f8f] hover:bg-[#ce6f8f]/10 font-medium py-2 rounded-lg text-sm
                           transition-colors disabled:opacity-60"
              >
                {loading ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </form>
        )}
      </div>
      {/* Admin tools */}
      <div className="mt-8 bg-[#1f2039] border border-[#3a3b58] rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[#ecf0f1]">Admin Tools</p>
            <p className="text-xs text-[#8a8fad] mt-0.5 max-w-sm">
              Unlocks destructive actions on account pages: Clear transactions, Repair bank sync,
              Enrich payees, and Clean up orphan accounts. Off by default.
            </p>
          </div>
          <button
            onClick={toggleAdminMode}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                        transition-colors duration-200 focus:outline-none ${
                          adminMode ? 'bg-[#e39400]' : 'bg-[#3a3b58]'
                        }`}
            role="switch"
            aria-checked={adminMode}
            title={adminMode ? 'Disable admin tools' : 'Enable admin tools'}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow
                          transition duration-200 ${
                            adminMode ? 'translate-x-5' : 'translate-x-0'
                          }`}
            />
          </button>
        </div>
        {adminMode && (
          <p className="mt-3 text-[10px] text-[#e39400] bg-[#e39400]/10 border border-[#e39400]/20 rounded px-2.5 py-1.5">
            Admin tools are ON — destructive actions are visible on account pages.
          </p>
        )}
      </div>

      {/* Danger zone */}
      <div className="mt-8 bg-[#1f2039] border border-[#ce6f8f]/30 rounded-xl p-5">
        <p className="text-sm font-medium text-[#ecf0f1] mb-1">Delete Account</p>
        <p className="text-xs text-[#8a8fad] mb-4">
          Permanently deletes your account, all budgets, transactions, and bank connections.
          This also calls Plaid’s /item/remove for every linked institution. This cannot be undone.
        </p>

        {setupStep !== 'delete-confirm' ? (
          <button
            onClick={() => { setSetupStep('delete-confirm'); setError(''); setCode('') }}
            className="w-full border border-[#ce6f8f] text-[#ce6f8f] hover:bg-[#ce6f8f]/10 font-medium py-2 rounded-lg text-sm transition-colors"
          >
            Delete my account
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[#8a8fad]">
              Type <strong className="text-[#ecf0f1] font-mono">delete</strong> to confirm.
            </p>
            <input
              type="text"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputCls}
              placeholder="delete"
            />
            {error && <p className="text-sm text-[#ce6f8f]">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setSetupStep('idle'); setError(''); setCode('') }}
                className="flex-1 border border-[#3a3b58] text-[#8a8fad] hover:text-[#ecf0f1] font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading || code !== 'delete'}
                onClick={async () => {
                  setLoading(true)
                  setError('')
                  const res = await fetch('/api/user/delete', { method: 'POST' })
                  if (!res.ok) {
                    const d = await res.json().catch(() => ({}))
                    setError(d.error ?? 'Failed to delete account')
                    setLoading(false)
                    return
                  }
                  await signOut({ redirect: false })
                  router.replace('/login')
                }}
                className="flex-1 bg-[#ce6f8f] hover:bg-[#d4789a] text-white font-semibold py-2 rounded-lg text-sm
                           transition-colors disabled:opacity-60"
              >
                {loading ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
