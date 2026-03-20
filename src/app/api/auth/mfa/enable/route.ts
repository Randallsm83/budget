import { NextRequest, NextResponse } from 'next/server'
import * as OTPAuth from 'otpauth'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { users } from '@/db/schema'
import { encrypt } from '@/lib/crypto'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { secret, code } = await req.json()
  if (!secret || !code) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) })
  const delta = totp.validate({ token: code.trim(), window: 1 })
  if (delta === null) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
  }

  // Encrypt the secret before persisting — sensitive user data must not be
  // stored in plaintext. Uses AES-256-GCM via the shared ENCRYPTION_KEY.
  await db
    .update(users)
    .set({ mfaSecret: encrypt(secret), mfaEnabled: true })
    .where(eq(users.id, session.user.id))

  return NextResponse.json({ success: true })
}
