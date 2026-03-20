import type { Metadata } from 'next'
import { SessionProvider } from 'next-auth/react'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { auth } from '@/auth'
import './globals.css'

export const metadata: Metadata = {
  title: 'Budget',
  description: 'Personal envelope budgeting',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  return (
    <html lang="en">
      <head>
        {/* Plaid Link SDK is loaded client-side from this domain */}
        <link rel="preconnect" href="https://cdn.plaid.com" />
        <link rel="dns-prefetch" href="https://cdn.plaid.com" />
      </head>
      <body className="antialiased">
        <SessionProvider session={session}>{children}</SessionProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
