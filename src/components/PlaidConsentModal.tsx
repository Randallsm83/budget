'use client'

interface Props {
  onConfirm: () => void
  onCancel: () => void
}

export function PlaidConsentModal({ onConfirm, onCancel }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-[#1f2039] border border-[#3a3b58] rounded-xl max-w-md w-full p-6 space-y-4">
        <h2 className="text-base font-semibold text-[#ecf0f1]">Connect your bank account</h2>

        <p className="text-sm text-[#8a8fad]">
          Coffer uses <strong className="text-[#ecf0f1]">Plaid</strong> to securely connect to your
          financial institution. By continuing, you authorise Coffer to access:
        </p>

        <ul className="space-y-1.5 text-sm text-[#8a8fad]">
          {[
            ['📋', 'Account names, types, and balances'],
            ['💳', 'Transaction history (for automatic syncing)'],
            ['📈', 'Investment holdings (optional, if you share them)'],
            ['🏦', 'Liability details — credit cards, loans (optional)'],
          ].map(([icon, label]) => (
            <li key={label as string} className="flex items-start gap-2">
              <span className="flex-shrink-0">{icon}</span>
              <span>{label}</span>
            </li>
          ))}
        </ul>

        <div className="bg-[#16172a] border border-[#2a2b45] rounded-lg px-4 py-3 space-y-1.5 text-xs text-[#8a8fad]">
          <p>🔒 Your credentials are <strong className="text-[#ecf0f1]">never</strong> seen or stored by Coffer — Plaid handles authentication directly.</p>
          <p>🔐 All data retrieved from Plaid is <strong className="text-[#ecf0f1]">encrypted at rest</strong> and never sold or shared with third parties.</p>
          <p>🗑 You can <strong className="text-[#ecf0f1]">disconnect your bank</strong> at any time from the account page.</p>
        </div>

        <p className="text-xs text-[#5a5b78]">
          By connecting, you agree to Plaid&apos;s{' '}
          <a
            href="https://plaid.com/legal/#end-user-privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#b3a1e6] hover:underline"
          >
            End User Privacy Policy
          </a>
          {process.env.NEXT_PUBLIC_PRIVACY_URL && (
            <>
              {' '}and Coffer&apos;s{' '}
              <a
                href={process.env.NEXT_PUBLIC_PRIVACY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#b3a1e6] hover:underline"
              >
                Privacy Policy
              </a>
            </>
          )}
          .
        </p>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 border border-[#3a3b58] text-[#8a8fad] hover:text-[#ecf0f1]
                       font-medium py-2 rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-[#b3a1e6] hover:bg-[#c678dd] text-[#1a1b2e]
                       font-semibold py-2 rounded-lg text-sm transition-colors"
          >
            Connect my bank
          </button>
        </div>
      </div>
    </div>
  )
}
