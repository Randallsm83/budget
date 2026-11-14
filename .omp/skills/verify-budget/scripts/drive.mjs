#!/usr/bin/env node
// Drive the running verify-budget instance in headless Google Chrome the way a user would,
// and record evidence (screenshots, step log, DB rows before/after, result.json).
// Usage: node drive.mjs <journey>   journeys: login add-account add-transaction assign search mfa all
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const env = JSON.parse(execFileSync('bash', ['-c', `. "${here}/env.sh" && node -e 'console.log(JSON.stringify(process.env))'`]).toString())
const { RUN, APP, TOOLS, EVIDENCE, BASE_URL, LOCAL_DB_URL } = env
const secrets = Object.fromEntries(fs.readFileSync(`${RUN}/secrets.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const { chromium } = createRequire(`${TOOLS}/package.json`)('playwright-core')
const appRequire = createRequire(`${APP}/package.json`)
const postgres = appRequire('postgres')
const OTPAuth = appRequire('otpauth')

const JOURNEYS = ['login', 'add-account', 'add-transaction', 'assign', 'search', 'mfa']
const journey = process.argv[2]
if (!JOURNEYS.includes(journey) && journey !== 'all') {
  console.error(`usage: drive.mjs <${JOURNEYS.join('|')}|all>`)
  process.exit(2)
}

const sql = postgres(LOCAL_DB_URL, { max: 2, onnotice: () => {} })
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, 'Z')
const mfaFile = `${RUN}/mfa.secret`

async function runJourney(name) {
  const dir = `${EVIDENCE}/${stamp}-${name}`
  fs.mkdirSync(dir, { recursive: true })
  const log = (step, extra = {}) => fs.appendFileSync(`${dir}/steps.jsonl`, JSON.stringify({ t: new Date().toISOString(), step, ...extra }) + '\n')
  let shot = 0
  const assertions = []
  const check = (label, pass, detail) => { assertions.push({ label, pass: !!pass, detail }); log('assert', { label, pass: !!pass, detail }) }

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  page.setDefaultTimeout(60_000) // first hit of a route compiles it in next dev
  page.on('console', (m) => { if (m.type() === 'error') log('console.error', { text: m.text() }) })
  page.on('response', (r) => { if (r.status() >= 400) log('http.error', { status: r.status(), url: r.url() }) })
  const snap = async (label) => {
    const file = `${String(++shot).padStart(2, '0')}-${label}.png`
    await page.screenshot({ path: `${dir}/${file}`, fullPage: true })
    log('screenshot', { file, url: page.url() })
  }
  const db = async (label, query) => {
    const rows = await query
    fs.writeFileSync(`${dir}/db-${label}.json`, JSON.stringify(rows, null, 2))
    log('db', { label, rows: rows.length })
    return rows
  }
  const userId = async () => (await sql`select id from users where email = ${secrets.VERIFY_USER_EMAIL}`)[0].id

  // ---- reusable user actions -------------------------------------------------------------
  async function login() {
    await page.goto(`${BASE_URL}/login`)
    await page.locator('input[type=email]').fill(secrets.VERIFY_USER_EMAIL)
    await page.locator('input[type=password]').fill(secrets.VERIFY_USER_PASSWORD)
    await page.getByRole('button', { name: 'Continue' }).click()
    const totp = page.locator('input[autocomplete=one-time-code]')
    await Promise.race([page.waitForURL(/\/budget\/\d{4}-\d{2}$/), totp.waitFor()])
    if (await totp.isVisible()) {
      log('totp-step')
      const secret = fs.readFileSync(mfaFile, 'utf8').trim()
      await totp.fill(new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate())
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.waitForURL(/\/budget\/\d{4}-\d{2}$/)
    }
    log('logged-in', { url: page.url() })
  }

  async function addAccount(accountName, balance) {
    await page.goto(`${BASE_URL}/accounts`)
    await page.getByRole('button', { name: '+ Add Account' }).click()
    const modal = page.locator('form').filter({ has: page.getByPlaceholder('e.g. Chase Checking') })
    await modal.getByPlaceholder('e.g. Chase Checking').fill(accountName)
    await modal.locator('select').selectOption('checking')
    await modal.getByPlaceholder('0.00').fill(balance)
    await snap('add-account-filled')
    await modal.getByRole('button', { name: 'Add Account', exact: true }).click()
    await modal.waitFor({ state: 'detached' })
    await page.getByRole('link', { name: new RegExp(accountName) }).first().waitFor()
    log('account-added', { accountName })
  }

  async function addTransaction(accountName, payee, categoryLabel, amount) {
    await page.goto(`${BASE_URL}/accounts`)
    await page.locator('main').getByRole('link', { name: new RegExp(accountName) }).first().click()
    await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/)
    await page.getByRole('button', { name: '+ Add Transaction' }).click()
    const modal = page.locator('form').filter({ has: page.getByPlaceholder('Who did you pay?') })
    await modal.getByPlaceholder('Who did you pay?').fill(payee)
    await modal.locator('select').nth(1).selectOption({ label: categoryLabel })
    await modal.getByRole('button', { name: 'Out', exact: true }).click()
    await modal.getByPlaceholder('0.00').fill(amount)
    await snap('add-transaction-filled')
    await modal.getByRole('button', { name: 'Add Transaction', exact: true }).click()
    await modal.waitFor({ state: 'detached' })
    log('transaction-added', { payee })
  }

  const rta = async () => (await page.getByText('Ready to Assign', { exact: true }).locator('xpath=following-sibling::p[1]').innerText()).trim()

  // ---- journeys --------------------------------------------------------------------------
  const journeys = {
    async login() {
      await page.goto(`${BASE_URL}/budget`)
      await page.waitForURL(/\/login\?callbackUrl=/)
      await snap('redirected-to-login')
      check('unauthenticated /budget redirects to /login', /\/login\?callbackUrl=%2Fbudget/.test(page.url()), page.url())
      await login()
      await snap('budget-after-login')
      check('lands on /budget/YYYY-MM', /\/budget\/\d{4}-\d{2}$/.test(page.url()), page.url())
      check('sidebar shows seeded user name', await page.getByText(secrets.VERIFY_USER_NAME, { exact: true }).first().isVisible())
    },

    async 'add-account'() {
      const name = `Verify Checking ${stamp}`
      await login()
      const uid = await userId()
      await db('before', sql`select id, name, type, balance from accounts where user_id = ${uid} order by created_at`)
      await addAccount(name, '1234.56')
      await snap('accounts-after-add')
      const [acct] = await db('after', sql`select id, name, type, balance, cleared_balance from accounts where user_id = ${uid} and name = ${name}`)
      check('accounts row inserted', acct, acct)
      check('balance stored as milliunits 1234560', acct?.balance === 1234560, acct?.balance)
      const txns = await db('after-transactions', sql`select payee, amount, cleared from transactions where account_id = ${acct?.id ?? null}`)
      check('starting-balance transaction 1234560 cleared', txns.length === 1 && txns[0].payee === 'Starting Balance' && txns[0].amount === 1234560 && txns[0].cleared, txns)
      check('account shown in both the Accounts list and the sidebar', await page.getByText(name).filter({ visible: true }).count() >= 2)
    },

    async 'add-transaction'() {
      const name = `Verify Txn Acct ${stamp}`
      const token = String(Date.now())
      const payee = `VERIFY GROCER ${token}`
      const shown = `Verify Grocer ${token}` // displayPayee() title-cases ALL-CAPS payees
      await login()
      await addAccount(name, '500.00')
      const uid = await userId()
      await db('before', sql`select a.balance from accounts a where a.user_id = ${uid} and a.name = ${name}`)
      await addTransaction(name, payee, 'Immediate Obligations: Groceries', '42.17')
      await page.getByText('$457.83').first().waitFor() // balances re-render once the action's refresh lands
      await snap('register-after-add')
      // The register renders a hidden mobile copy of each row; only count the visible one.
      const row = page.getByText(shown).filter({ visible: true }).first()
      check('new row visible in register without reload', await row.isVisible())
      await page.reload()
      await row.waitFor()
      await snap('register-after-reload')
      const rows = await db('after', sql`
        select t.payee, t.amount, c.name as category, a.balance as account_balance
        from transactions t join accounts a on a.id = t.account_id left join categories c on c.id = t.category_id
        where t.user_id = ${uid} and t.payee = ${payee}`)
      check('transaction row inserted once', rows.length === 1, rows)
      check('outflow stored as -42170 milliunits', rows[0]?.amount === -42170, rows[0]?.amount)
      check('categorised as Groceries', rows[0]?.category === 'Groceries', rows[0]?.category)
      check('account balance 500000 - 42170 = 457830', rows[0]?.account_balance === 457830, rows[0]?.account_balance)
      check('register shows title-cased payee after reload', await row.isVisible())
      const rules = await db('after-payee-rules', sql`select r.payee_normalized, c.name as category from payee_rules r left join categories c on c.id = r.category_id where r.user_id = ${uid}`)
      check('payee rule learned -> Groceries', rules.some((r) => r.category === 'Groceries'), rules)
    },

    async assign() {
      await login()
      const uid = await userId()
      const onBudget = await sql`select count(*)::int as n from accounts where user_id = ${uid} and type in ('checking','savings','cash','credit_card')`
      if (onBudget[0].n === 0) await addAccount(`Verify Budget Acct ${stamp}`, '1234.56')
      await page.goto(`${BASE_URL}/budget`)
      await page.waitForURL(/\/budget\/\d{4}-\d{2}$/)
      const month = page.url().slice(-7)
      const row = page.locator('div.hidden.sm\\:grid').filter({ has: page.getByText('Groceries', { exact: true }) })
      const cell = row.getByRole('button').first()
      const before = { rta: await rta(), assigned: (await cell.innerText()).trim() }
      await db('before', sql`select mb.budgeted from month_budgets mb join categories c on c.id = mb.category_id where c.user_id = ${uid} and c.name = 'Groceries' and mb.month = ${month}`)
      await snap('budget-before')
      const target = (Number(before.assigned.replace(/[$,]/g, '')) + 100).toFixed(2)
      await cell.click()
      await row.locator('input').fill(target)
      await row.locator('input').press('Enter')
      await row.getByRole('button', { name: `$${Number(target).toLocaleString('en-US', { minimumFractionDigits: 2 })}` }).waitFor()
      let saved = []
      for (let i = 0; i < 40 && !saved.length; i++) {
        saved = await sql`select mb.budgeted from month_budgets mb join categories c on c.id = mb.category_id where c.user_id = ${uid} and c.name = 'Groceries' and mb.month = ${month} and mb.budgeted = ${Math.round(Number(target) * 1000)}`
        if (!saved.length) await new Promise((r) => setTimeout(r, 250))
      }
      await page.reload()
      const after = { rta: await rta(), assigned: (await row.getByRole('button').first().innerText()).trim() }
      await snap('budget-after-reload')
      await db('after', sql`select mb.month, mb.budgeted from month_budgets mb join categories c on c.id = mb.category_id where c.user_id = ${uid} and c.name = 'Groceries' and mb.month = ${month}`)
      log('values', { month, before, after })
      check(`month_budgets.budgeted = ${Number(target) * 1000} for Groceries ${month}`, saved.length === 1, saved)
      check('assigned survives reload', after.assigned === `$${Number(target).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, after.assigned)
      const toMilli = (s) => Math.round(Number(s.replace(/[$,]/g, '')) * 1000)
      check('Ready to Assign drops by exactly $100.00', toMilli(before.rta) - toMilli(after.rta) === 100000, { before: before.rta, after: after.rta })
    },

    async search() {
      const name = `Verify Search Acct ${stamp}`
      const token = String(Date.now())
      const payee = `VERIFY GROCER ${token}`
      await login()
      await addAccount(name, '300.00')
      await addTransaction(name, payee, 'Immediate Obligations: Groceries', '12.34')
      await page.goto(`${BASE_URL}/transactions`)
      await page.getByPlaceholder('Search payee, memo…').fill(token)
      await page.getByText(/^1 transaction\b/).first().waitFor()
      await snap('search-result')
      const uid = await userId()
      await db('after', sql`select payee, amount from transactions where user_id = ${uid} and payee like ${'%' + token}`)
      check('header counts exactly 1 transaction', /^1 transaction\b/.test((await page.getByText(/^\d+ transactions?/).first().innerText()).trim()))
      check('result row shows title-cased payee', await page.getByText(`Verify Grocer ${token}`).first().isVisible())
      check('starting balance row filtered out', !(await page.getByText('Starting Balance').first().isVisible().catch(() => false)))
    },

    async mfa() {
      await login()
      await page.goto(`${BASE_URL}/settings/security`)
      await page.getByRole('button', { name: 'Set up authenticator app' }).click()
      await page.getByText("Can't scan? Enter manually").click()
      const secret = (await page.locator('details p.font-mono').innerText()).trim()
      fs.writeFileSync(mfaFile, secret, { mode: 0o600 })
      await page.getByPlaceholder('000000').fill(new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate())
      await page.getByRole('button', { name: 'Enable', exact: true }).click()
      await page.getByText('Authenticator app enabled successfully.').waitFor()
      await snap('mfa-enabled')
      const [u] = await db('after', sql`select mfa_enabled, mfa_secret like '%:%:%' as secret_encrypted, mfa_secret = ${secret} as secret_plaintext from users where email = ${secrets.VERIFY_USER_EMAIL}`)
      check('users.mfa_enabled = true', u.mfa_enabled === true, u)
      check('mfa_secret stored encrypted (iv:tag:ct), not plaintext', u.secret_encrypted && !u.secret_plaintext, u)
      await page.context().clearCookies()
      await page.goto(`${BASE_URL}/login`)
      await page.locator('input[type=email]').fill(secrets.VERIFY_USER_EMAIL)
      await page.locator('input[type=password]').fill(secrets.VERIFY_USER_PASSWORD)
      await page.getByRole('button', { name: 'Continue' }).click()
      const totp = page.locator('input[autocomplete=one-time-code]')
      await totp.waitFor()
      await totp.fill('000000')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.getByText('Invalid authenticator code.').waitFor()
      await snap('wrong-code-rejected')
      check('wrong TOTP code rejected', /\/login/.test(page.url()), page.url())
      await totp.fill(new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate())
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.waitForURL(/\/budget\/\d{4}-\d{2}$/)
      await snap('signed-in-with-totp')
      check('correct TOTP signs in', /\/budget\/\d{4}-\d{2}$/.test(page.url()), page.url())
    },
  }

  log('start', { journey: name, base: BASE_URL, commit: fs.readFileSync(`${RUN}/commit`, 'utf8').trim() })
  let error = null
  try {
    await journeys[name]()
  } catch (err) {
    error = String(err?.stack ?? err)
    log('error', { error })
    await snap('failure').catch(() => {})
  } finally {
    await browser.close()
  }
  const ok = !error && assertions.length > 0 && assertions.every((a) => a.pass)
  fs.writeFileSync(`${dir}/result.json`, JSON.stringify({ journey: name, ok, error, assertions, evidence: dir }, null, 2))
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} -> ${dir}`)
  for (const a of assertions) console.log(`  ${a.pass ? 'ok  ' : 'FAIL'} ${a.label}`)
  if (error) console.log(`  error: ${error.split('\n')[0]}`)
  return ok
}

let allOk = true
for (const j of journey === 'all' ? JOURNEYS : [journey]) allOk = (await runJourney(j)) && allOk
await sql.end()
process.exit(allOk ? 0 : 1)
