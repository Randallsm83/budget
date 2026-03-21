# App Flows — Budget UX Audit Reference

Audit flows in this order. Each flow lists the URL/entry point, the steps to walk, and what to specifically watch for.

---

## 1. Login

**URL:** `/login`

Steps:
- Land on the login page cold (no session)
- Attempt login with wrong password — observe error
- Attempt login with correct credentials — observe transition
- If MFA is enabled: observe the TOTP prompt, try wrong code, then correct code

Watch for:
- Is it clear this is a login page or could it be mistaken for a sign-up page?
- Are errors specific ("Wrong password") or vague ("Login failed")?
- Is there a "forgot password" path? If not, is the absence noticeable?
- Does the MFA step explain what app to use or where to get the code?
- What does the redirect feel like — instant, or jarring?

---

## 2. Empty State (New User)

**Scenario:** Log in as a user with zero accounts, zero categories, zero transactions.

Steps:
- Observe the budget page with nothing set up
- Observe the accounts page with nothing set up
- Try to navigate to a budget month — what renders?

Watch for:
- Is there a clear call-to-action ("Add your first account")?
- Does the app explain what to do next, or just show an empty shell?
- Is "Ready to Assign" visible and does it say $0.00 in a way that makes sense to a newcomer?
- Is it clear that you need accounts before anything else works?

---

## 3. Add Account (Manual)

**Entry:** Sidebar "Add Account" button (or wherever it lives)

Steps:
- Open the add account modal
- Try each account type (checking, savings, credit card, investment, etc.)
- Enter a starting balance
- Save and observe the result in the sidebar

Watch for:
- Are account type names self-explanatory (what's the difference between "other" and "investment")?
- Is on-budget vs. tracking explained anywhere?
- Does the starting balance field make sense — is it clear what "starting balance" means (current balance? historical balance?)?
- After adding, is it obvious the account now appears and is ready to use?
- Can you add multiple accounts without the flow resetting awkwardly?

---

## 4. Connect Bank via Plaid

**Entry:** The Plaid Link button / "Connect Bank" option

Steps:
- Click the bank connection button
- Observe the consent modal (`PlaidConsentModal`) before Plaid Link opens
- Walk through Plaid Link (use sandbox credentials: `user_good` / `pass_good`)
- Observe post-connection state

Watch for:
- Is the consent modal clear about what data will be accessed?
- Is it clear this will import real transactions?
- What does the success state look like — do accounts appear immediately?
- Is there any loading/progress feedback while transactions are syncing?
- What happens if the user closes Plaid Link mid-flow?

---

## 5. Budget Page — Core Assignment Flow

**URL:** `/budget/YYYY-MM`

Steps:
- Land on the budget page for the current month
- Observe the "Ready to Assign" (RTA) number at the top
- Click into a budgeted cell and type an amount — observe inline edit behavior
- Assign money to several categories until RTA reaches $0
- Try to over-assign (go negative on RTA) — observe the feedback
- Collapse and expand a category group

Watch for:
- Is "Ready to Assign" prominently visible and obviously important?
- Is it clear what RTA means? Is the label self-explanatory?
- Is the inline budget edit discoverable — does it look clickable?
- Is there a pending/loading indicator when saving a budget amount?
- Is negative RTA clearly communicated and visually alarming?
- Is the difference between Budgeted / Activity / Balance obvious at a glance?
- Does the column header explain what each column is?
- Is the "Cover" quick-action button (covers to $0) discoverable and explained?
- Are overspent categories (red balance) obvious enough to act on?

---

## 6. Month Navigation

**Entry:** Prev/next month arrows on the budget page

Steps:
- Navigate to previous months
- Navigate to a future month
- Observe what the URL looks like
- Try manually editing the URL to a bad month format

Watch for:
- Is the current month clearly displayed?
- Is navigating months intuitive — do the controls look clickable?
- Does the future month state make sense (no transactions yet, but budgets can be set)?
- Is there a "go to today" / "go to current month" shortcut?

---

## 7. Add Manual Transaction

**Entry:** "Add Transaction" button on the accounts page or budget page

Steps:
- Open the Add Transaction modal
- Fill in account, payee, amount, category, date
- Toggle between inflow and outflow
- Save — observe the result
- Immediately edit the transaction
- Delete the transaction

Watch for:
- Is the outflow/inflow toggle obvious and labeled clearly?
- Is "category" required or optional — and is that communicated?
- Is the flat category `<select>` usable with 30+ categories? Can you search/filter?
- Is "Inflow / Ready to Assign" as a category option confusing or clear?
- What does the date field look like on mobile — is the native date picker usable?
- After saving, is there visual confirmation (toast, row appears)?
- Is editing a transaction easy to trigger (hover reveal, or always visible)?
- Is deleting reversible — is there an undo or confirmation?

---

## 8. Account Register

**URL:** `/accounts/[accountId]`

Steps:
- Open an account from the sidebar
- Scroll through the transaction list
- Filter or sort transactions (if available)
- Click a transaction to edit it
- Observe the transfer toggle (↔) on hover

Watch for:
- Is it clear which account you're viewing?
- Is the transaction list ordered sensibly by default (newest first)?
- Is the running balance shown? Is it clear what it represents?
- Is the hover-to-reveal transfer toggle discoverable on desktop? What about mobile?
- Are cleared vs. uncleared transactions differentiated?
- Is CSV import easy to find and understand?

---

## 9. CSV Import

**Entry:** Import button in the accounts page

Steps:
- Download a sample CSV or create one (date, payee, amount columns)
- Open the CSV import modal
- Map columns
- Preview and confirm import
- Observe the transactions appear

Watch for:
- Is the expected CSV format documented anywhere in the UI?
- Is column mapping intuitive?
- Are import errors (wrong format, duplicate rows) explained clearly?
- After import, is it clear how many transactions were added?

---

## 10. CC Payment Workflow

**Scenario:** User has a credit card account with spending on it.

Steps:
- Observe the "Credit Card Payments" section at the bottom of the budget
- Note the auto-funded amount
- Try to manually adjust the CC payment budget amount (it should be read-only)
- Make a payment transaction (checking → CC) and observe how the CC payment category updates

Watch for:
- Is the CC Payments section explained anywhere? A first-time user has no idea why it exists.
- Is the auto-funding concept ever explained?
- Does the read-only nature of the CC payment budgeted field feel intentional or broken?
- Is it obvious when a CC balance is fully funded vs. underfunded?

---

## 11. Relink / New Accounts Banners

**Scenario:** An account requires relink (`requiresRelink = true`) or has new accounts available.

Steps:
- Observe the amber `RelinkBanner` or cyan `NewAccountsBanner` at the top of the app
- Click the Relink/New Accounts button
- Walk through the Plaid update flow
- Observe the banner disappearing after success

Watch for:
- Is the banner message clear about what's wrong and what to do?
- Is "Relink" jargon obvious, or does it need a plain-language explanation?
- Is the urgency of the situation (transactions not syncing) communicated?

---

## 12. Settings — Security / MFA

**URL:** `/settings/security`

Steps:
- Find the settings page from the nav
- Observe the MFA section
- Set up TOTP MFA (scan QR, enter code)
- Observe confirmation
- Disable MFA

Watch for:
- Is the path to settings discoverable (where is the link in the nav)?
- Is the MFA setup flow self-guided — does it explain what TOTP is?
- Is the QR code scannable at the displayed size?
- Is the confirmation step (enter code to verify) clearly explained?
- Is disabling MFA appropriately protected (requires current code)?

---

## 13. Mobile Audit

Resize viewport to 375×812 and re-audit these specific surfaces:

- Budget table: Can you scroll horizontally? Are columns usable at narrow width?
- Drag-to-reorder categories: Does it work on touch? (Likely broken — note it)
- Add Transaction modal: Is the form usable on mobile keyboard?
- Sidebar account list: Is it accessible on mobile?
- Navigation between pages: Is there a mobile nav?
