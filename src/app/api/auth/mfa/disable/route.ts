import { NextRequest, NextResponse } from 'next/server'
import * as OTPAuth from 'otpauth'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { users } from '@/db/schema'
import { decrypt } from '@/lib/crypto'

// Handles both encrypted (ivHex:tagHex:ciphertextHex) and legacy plaintext base32 secrets.
function resolveMfaSecret(stored: string): string {
  return stored.includes(':') ? decrypt(stored) : stored
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { code } = await req.json()
  if (!code) {
    return NextResponse.json({ error: 'Missing code' }, { status: 400 })
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })
  if (!user?.mfaSecret) {
    return NextResponse.json({ error: 'MFA not enabled' }, { status: 400 })
  }

  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(resolveMfaSecret(user.mfaSecret)) })
  const delta = totp.validate({ token: code.trim(), window: 1 })
  if (delta === null) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
  }

  await db
    .update(users)
    .set({ mfaSecret: null, mfaEnabled: false })
    .where(eq(users.id, session.user.id))

  return NextResponse.json({ success: true })
}
