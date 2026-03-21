import Image from 'next/image'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { eq, asc, and } from 'drizzle-orm'
import { db } from '@/db'
import { accounts, importConnections } from '@/db/schema'
import { NavLink } from '@/components/NavLink'
import { SignOutButton } from '@/components/SignOutButton'
import { AppShell } from '@/components/AppShell'
import { AccountsNav } from '@/components/AccountsNav'
import { formatMoney } from '@/lib/budget'

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
    .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt))

  // Fetch accounts whose bank connection needs re-authentication (with names for the banner)
  const relinkRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(importConnections)
    .innerJoin(accounts, eq(importConnections.accountId, accounts.id))
    .where(and(eq(importConnections.userId, session.user.id), eq(importConnections.requiresRelink, true)))
  // Deduplicate by account id (multiple connections can share an account)
  const relinkAccountMap = new Map(relinkRows.map((r) => [r.id, r]))
  const relinkAccounts = [...relinkAccountMap.values()]
  const relinkAccountIds = new Set(relinkAccounts.map((r) => r.id))

  // New accounts available — one representative account per Plaid Item
  const newAccountsRows = await db
    .select({ id: accounts.id, name: accounts.name, plaidItemId: importConnections.plaidItemId })
    .from(importConnections)
    .innerJoin(accounts, eq(importConnections.accountId, accounts.id))
    .where(and(eq(importConnections.userId, session.user.id), eq(importConnections.newAccountsAvailable, true)))
  const seenItems = new Set<string>()
  const newAccountsItems = newAccountsRows.filter((r) => {
    if (!r.plaidItemId || seenItems.has(r.plaidItemId)) return false
    seenItems.add(r.plaidItemId)
    return true
  })

  const cashAccounts = userAccounts.filter((a) => !LIABILITY_TYPES.has(a.type) && !INVESTMENT_TYPES.has(a.type) && !PROPERTY_TYPES.has(a.type))
  const investmentAccounts = userAccounts.filter((a) => INVESTMENT_TYPES.has(a.type))
  const propertyAccounts = userAccounts.filter((a) => PROPERTY_TYPES.has(a.type))
  const liabilities = userAccounts.filter((a) => LIABILITY_TYPES.has(a.type))
  const cashTotal = cashAccounts.reduce((s, a) => s + a.balance, 0)
  const investmentTotal = investmentAccounts.reduce((s, a) => s + a.balance, 0)
  const propertyTotal = propertyAccounts.reduce((s, a) => s + a.balance, 0)
  const liabilityTotal = liabilities.reduce((s, a) => s + a.balance, 0)
  const netWorth = cashTotal + investmentTotal + propertyTotal + liabilityTotal

  const sidebarContent = (
    <>
        {/* Branding */}
        <div className="px-4 py-4 border-b border-[#3a3b58]">
          <div className="flex items-center gap-2">
            <Image src="/logo.svg" alt="" aria-hidden width={28} height={28} className="flex-shrink-0" unoptimized />
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

          <AccountsNav
            cashAccounts={cashAccounts.map((a) => ({ ...a, needsRelink: relinkAccountIds.has(a.id) }))}
            investmentAccounts={investmentAccounts.map((a) => ({ ...a, needsRelink: relinkAccountIds.has(a.id) }))}
            propertyAccounts={propertyAccounts.map((a) => ({ ...a, needsRelink: relinkAccountIds.has(a.id) }))}
            liabilities={liabilities.map((a) => ({ ...a, needsRelink: relinkAccountIds.has(a.id) }))}
            cashTotal={cashTotal}
            investmentTotal={investmentTotal}
            propertyTotal={propertyTotal}
            liabilityTotal={liabilityTotal}
          />

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
          <NavLink href="/settings/security">
            <span>⚙️</span>
            Settings
          </NavLink>
          <SignOutButton />
        </div>
    </>
  )

  return (
    <AppShell sidebarContent={sidebarContent} relinkAccounts={relinkAccounts} newAccountsItems={newAccountsItems}>
      {children}
    </AppShell>
  )
}
