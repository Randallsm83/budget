# Sign-in and MFA

Budget is invite-only. Signed-out visitors to `/budget` or `/accounts` are sent to `/login`. A user signs in with email and password and, if they enabled an authenticator app in Security settings, must also enter a valid 6-digit TOTP code. The TOTP secret is stored encrypted.

## Sub-features

- `auth-gate` redirects signed-out `/budget` to `/login?callbackUrl=%2Fbudget`.
- `auth-credentials` signs in with email + password and lands on `/budget/YYYY-MM` (current month).
- `mfa-enrol` enables TOTP from `Settings` and stores the secret encrypted (`iv:tag:ciphertext`).
- `mfa-wrong-code` rejects a bad code with `Invalid authenticator code.` and stays on `/login`.
- `mfa-sign-in` signs in with password + current code.

## How to get to it (user POV)

- Open any app URL while signed out, or go to `/login` directly.
- Sidebar `⚙️ Settings` → `/settings/security` → `Set up authenticator app`.

## Driving it with drive.mjs

Preconditions:

- Baseline instance (seeded user, MFA off). `mfa` changes the user for the rest of the instance's life; run it last or relaunch afterwards.

- **Gate.** Visit `/budget` signed out. `node scripts/drive.mjs login`. URL becomes `/login?callbackUrl=%2Fbudget` (screenshot `01-redirected-to-login`).
- **Credentials.** Fill `input[type=email]` and `input[type=password]`, choose button `Continue`. Same journey. URL matches `/budget/\d{4}-\d{2}$` and the sidebar shows `Verifier`.
- **Enrol.** On `/settings/security` choose `Set up authenticator app`, open `Can't scan? Enter manually`, read the base32 secret from `details p.font-mono`, type a TOTP code into placeholder `000000`, choose `Enable`. `node scripts/drive.mjs mfa`. Text `Authenticator app enabled successfully.` appears; `db-after.json` shows `mfa_enabled: true`, `secret_encrypted: true`, `secret_plaintext: false`.
- **Wrong code.** Clear cookies, sign in again: after `Continue` the field `input[autocomplete=one-time-code]` appears; enter `000000`, choose `Sign in`. Same journey. `Invalid authenticator code.` shows and the URL stays on `/login`.
- **Right code.** Enter the current code, choose `Sign in`. Same journey. URL reaches `/budget/YYYY-MM`.

## Gotchas

- `mfa` writes the secret to `run/mfa.secret` (mode 600) so later journeys can pass the TOTP step; cleanup deletes it.
- `POST /api/auth/check` (password check) runs before NextAuth `signIn`; a 401 there shows `Invalid email or password.` without reaching NextAuth.
- TOTP uses a ±1 step window. A code generated right at a 30 s boundary can still fail; rerun before calling it a bug.
- There is no self-service password reset or sign-up; the only user is the seeded one.
