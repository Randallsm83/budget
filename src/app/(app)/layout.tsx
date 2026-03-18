import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { eq, asc, and } from 'drizzle-orm'
import { db } from '@/db'
import { accounts } from '@/db/schema'
import { NavLink } from '@/components/NavLink'
import { SignOutButton } from '@/components/SignOutButton'
import { formatMoney } from '@/lib/budget'

const TYPE_ICONS: Record<string, string> = {
  checking: '🏦',
  savings: '💵',
  credit_card: '💳',
  cash: '💸',
  loan: '🏠',
  real_estate: '🏠',
  vehicle: '🚗',
  investment: '📈',
  other: '📁',
}

const LIABILITY_TYPES = new Set(['credit_card', 'loan'])
const INVESTMENT_TYPES = new Set(['investment'])
const PROPERTY_TYPES = new Set(['real_estate', 'vehicle', 'other'])

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  const userAccounts = await db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type, balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.userId, session.user.id), eq(accounts.closed, false)))
    .orderBy(asc(accounts.createdAt))

  const cashAccounts = userAccounts.filter((a) => !LIABILITY_TYPES.has(a.type) && !INVESTMENT_TYPES.has(a.type) && !PROPERTY_TYPES.has(a.type))
  const investmentAccounts = userAccounts.filter((a) => INVESTMENT_TYPES.has(a.type))
  const propertyAccounts = userAccounts.filter((a) => PROPERTY_TYPES.has(a.type))
  const liabilities = userAccounts.filter((a) => LIABILITY_TYPES.has(a.type))
  const cashTotal = cashAccounts.reduce((s, a) => s + a.balance, 0)
  const investmentTotal = investmentAccounts.reduce((s, a) => s + a.balance, 0)
  const propertyTotal = propertyAccounts.reduce((s, a) => s + a.balance, 0)
  const liabilityTotal = liabilities.reduce((s, a) => s + a.balance, 0)
  const netWorth = cashTotal + investmentTotal + propertyTotal + liabilityTotal

  return (
    <div className="flex h-screen bg-[#1a1b2e] text-[#ecf0f1] overflow-hidden">
      {/* Sidebar */}
      <nav className="w-56 flex-shrink-0 bg-[#1f2039] flex flex-col border-r border-[#3a3b58]">
        {/* Branding */}
        <div className="px-4 py-4 border-b border-[#3a3b58]">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="" aria-hidden="true" className="w-7 h-7 flex-shrink-0" />
            <h1 className="text-lg font-bold text-[#b3a1e6] tracking-tight">Budget</h1>
          </div>
          <p className="text-xs text-[#8a8fad] mt-0.5 truncate">{session.user?.name}</p>
        </div>

        {/* Nav links */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <NavLink href="/budget">
            <span>📊</span>
            Budget
          </NavLink>

          <NavLink href="/accounts" exact>
            <span>🏦</span>
            Accounts
          </NavLink>

          {/* Cash & Bank */}
          {cashAccounts.length > 0 && (
            <>
              <div className="px-3 pt-1.5 pb-0.5 flex justify-between items-center">
                <span className="text-[9px] font-semibold text-[#5ccc96] uppercase tracking-widest">Cash & Bank</span>
                <span className="text-[9px] text-[#5ccc96] tabular-nums">{formatMoney(cashTotal)}</span>
              </div>
              {cashAccounts.map((account) => (
                <NavLink key={account.id} href={`/accounts/${account.id}`}>
                  <span className="text-base leading-none flex-shrink-0">{TYPE_ICONS[account.type] ?? '📁'}</span>
                  <span className="flex-1 truncate text-xs">{account.name}</span>
                  <span className="text-xs tabular-nums flex-shrink-0 text-[#5ccc96]">{formatMoney(account.balance)}</span>
                </NavLink>
              ))}
            </>
          )}

          {/* Investments */}
          {investmentAccounts.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-0.5 flex justify-between items-center">
                <span className="text-[9px] font-semibold text-[#f2ce00] uppercase tracking-widest">Investments</span>
                <span className="text-[9px] text-[#f2ce00] tabular-nums">{formatMoney(investmentTotal)}</span>
              </div>
              {investmentAccounts.map((account) => (
                <NavLink key={account.id} href={`/accounts/${account.id}`}>
                  <span className="text-base leading-none flex-shrink-0">{TYPE_ICONS[account.type] ?? '📁'}</span>
                  <span className="flex-1 truncate text-xs">{account.name}</span>
                  <span className="text-xs tabular-nums flex-shrink-0 text-[#f2ce00]">{formatMoney(account.balance)}</span>
                </NavLink>
              ))}
            </>
          )}

          {/* Property */}
          {propertyAccounts.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-0.5 flex justify-between items-center">
                <span className="text-[9px] font-semibold text-[#00a3cc] uppercase tracking-widest">Property</span>
                <span className="text-[9px] text-[#00a3cc] tabular-nums">{formatMoney(propertyTotal)}</span>
              </div>
              {propertyAccounts.map((account) => (
                <NavLink key={account.id} href={`/accounts/${account.id}`}>
                  <span className="text-base leading-none flex-shrink-0">{TYPE_ICONS[account.type] ?? '📁'}</span>
                  <span className="flex-1 truncate text-xs">{account.name}</span>
                  <span className="text-xs tabular-nums flex-shrink-0 text-[#00a3cc]">{formatMoney(account.balance)}</span>
                </NavLink>
              ))}
            </>
          )}

          {/* Liabilities */}
          {liabilities.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-0.5 flex justify-between items-center">
                <span className="text-[9px] font-semibold text-[#ce6f8f] uppercase tracking-widest">Liabilities</span>
                <span className="text-[9px] text-[#ce6f8f] tabular-nums">{formatMoney(liabilityTotal)}</span>
              </div>
              {liabilities.map((account) => (
                <NavLink key={account.id} href={`/accounts/${account.id}`}>
                  <span className="text-base leading-none flex-shrink-0">{TYPE_ICONS[account.type] ?? '📁'}</span>
                  <span className="flex-1 truncate text-xs">{account.name}</span>
                  <span className="text-xs tabular-nums flex-shrink-0 text-[#ce6f8f]">{formatMoney(account.balance)}</span>
                </NavLink>
              ))}
            </>
          )}

          {userAccounts.length > 0 && (
            <div className="mx-2 mt-2 px-3 py-1.5 flex justify-between items-center border-t border-[#3a3b58]">
              <span className="text-[10px] text-[#8a8fad] uppercase tracking-wide">Net Worth</span>
              <span
                className={`text-xs font-semibold tabular-nums ${
                  netWorth < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'
                }`}
              >
                {formatMoney(netWorth)}
              </span>
            </div>
          )}
        </div>

        {/* Sign out */}
        <div className="p-2 border-t border-[#3a3b58]">
          <div className="px-2 pb-1">
            <a
              href="/settings/security"
              className="text-[10px] text-[#5a5b78] hover:text-[#8a8fad] transition-colors"
            >
              Security settings
            </a>
          </div>
          <SignOutButton />
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">{children}</main>
    </div>
  )
}
