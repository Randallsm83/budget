import { NextResponse } from 'next/server'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { auth } from '@/auth'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const secret = new OTPAuth.Secret()
  const secretBase32 = secret.base32
  const totp = new OTPAuth.TOTP({
    issuer: 'Coffer',
    label: session.user.email ?? session.user.id,
    secret,
  })
  const otpAuthUrl = totp.toString()
  const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl)

  return NextResponse.json({ secret: secretBase32, qrCodeDataUrl })
}
