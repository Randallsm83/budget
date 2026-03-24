import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  unique,
  real,
  jsonb,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  mfaSecret: text('mfa_secret'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Budget accounts (checking, savings, credit card, etc.)
// Note: "accounts" here refers to budget accounts, NOT auth provider accounts.
// ---------------------------------------------------------------------------
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // 'checking' | 'savings' | 'credit_card' | 'cash' | 'other'
  type: text('type').notNull(),
  balance: integer('balance').notNull().default(0), // milliunits
  clearedBalance: integer('cleared_balance').notNull().default(0), // milliunits
  closed: boolean('closed').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Category groups and categories
// ---------------------------------------------------------------------------
export const categoryGroups = pgTable('category_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isIncome: boolean('is_income').notNull().default(false),
  isTransfer: boolean('is_transfer').notNull().default(false),
  // isSystem = auto-managed by the app (e.g. Credit Card Payments group)
  isSystem: boolean('is_system').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id')
    .notNull()
    .references(() => categoryGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // ccAccountId: set when this category is the CC payment bucket for a credit card account
  ccAccountId: uuid('cc_account_id').references(() => accounts.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Month budgets — one row per (user, category, month)
// Stores only the budgeted amount; activity and balance are computed at query time.
// ---------------------------------------------------------------------------
export const monthBudgets = pgTable(
  'month_budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    month: text('month').notNull(), // 'YYYY-MM'
    budgeted: integer('budgeted').notNull().default(0), // milliunits
  },
  (t) => [unique('ux_month_budgets').on(t.userId, t.categoryId, t.month)],
)

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  // null = inflow / ready-to-assign (not yet categorized)
  categoryId: uuid('category_id').references(() => categories.id, {
    onDelete: 'set null',
  }),
  date: date('date').notNull(),
  payee: text('payee'),
  // milliunits — negative = outflow, positive = inflow
  amount: integer('amount').notNull(),
  memo: text('memo'),
  cleared: boolean('cleared').notNull().default(false),
  reconciled: boolean('reconciled').notNull().default(false),
  isTransfer: boolean('is_transfer').notNull().default(false),
  importId: text('import_id').unique(), // dedup key for Plaid / CSV import
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Payee rules — learns category from user corrections
// ---------------------------------------------------------------------------
export const payeeRules = pgTable(
  'payee_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    payeeNormalized: text('payee_normalized').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('ux_payee_rules').on(t.userId, t.payeeNormalized)],
)

// ---------------------------------------------------------------------------
// Import connections (Plaid — Phase 3)
// ---------------------------------------------------------------------------
export const importConnections = pgTable('import_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id, {
    onDelete: 'set null',
  }),
  plaidItemId: text('plaid_item_id'),
  plaidInstitutionId: text('plaid_institution_id'), // for duplicate Item detection
  plaidAccountId: text('plaid_account_id'), // Plaid-side account identifier for filtering
  accessTokenEncrypted: text('access_token_encrypted'),
  cursor: text('cursor'), // Plaid sync cursor
  lastSyncedAt: timestamp('last_synced_at'),
  // Set true by webhook (PENDING_DISCONNECT, PENDING_EXPIRATION, ITEM_LOGIN_REQUIRED);
  // cleared to false after a successful sync.
  requiresRelink: boolean('requires_relink').notNull().default(false),
  // Set true by NEW_ACCOUNTS_AVAILABLE webhook; cleared when user completes the add-accounts flow.
  newAccountsAvailable: boolean('new_accounts_available').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Investment holdings — one row per (accountId, plaidSecurityId)
// ---------------------------------------------------------------------------
export const investmentHoldings = pgTable(
  'investment_holdings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    plaidSecurityId: text('plaid_security_id').notNull(),
    name: text('name').notNull(),
    tickerSymbol: text('ticker_symbol'),
    securityType: text('security_type'),
    quantity: real('quantity').notNull(),
    institutionPrice: real('institution_price').notNull(),
    institutionValue: real('institution_value').notNull(),
    costBasis: real('cost_basis'),
    isoCurrencyCode: text('iso_currency_code'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [unique('ux_investment_holdings').on(t.accountId, t.plaidSecurityId)],
)

// ---------------------------------------------------------------------------
// Liability details — one row per account (credit, student, mortgage)
// ---------------------------------------------------------------------------
export const liabilityDetails = pgTable(
  'liability_details',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    liabilityType: text('liability_type').notNull(), // 'credit' | 'student' | 'mortgage'
    details: jsonb('details').notNull(),
    syncedAt: timestamp('synced_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [unique('ux_liability_details').on(t.accountId)],
)

// ---------------------------------------------------------------------------
// AI assistant persistence
// ---------------------------------------------------------------------------
export const aiConversations = pgTable('ai_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('New conversation'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const aiMessages = pgTable('ai_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => aiConversations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const aiRecommendations = pgTable('ai_recommendations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  month: text('month').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  dismissed: boolean('dismissed').notNull().default(false),
  applied: boolean('applied').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const aiAuditEvents = pgTable('ai_audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  route: text('route').notNull(),
  model: text('model'),
  promptVersion: text('prompt_version'),
  latencyMs: integer('latency_ms'),
  tokenUsage: integer('token_usage'),
  safetyFlags: jsonb('safety_flags'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  categoryGroups: many(categoryGroups),
  categories: many(categories),
  monthBudgets: many(monthBudgets),
  transactions: many(transactions),
  importConnections: many(importConnections),
  payeeRules: many(payeeRules),
  investmentHoldings: many(investmentHoldings),
  liabilityDetails: many(liabilityDetails),
  aiConversations: many(aiConversations),
  aiMessages: many(aiMessages),
  aiRecommendations: many(aiRecommendations),
  aiAuditEvents: many(aiAuditEvents),
}))

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
  transactions: many(transactions),
  importConnections: many(importConnections),
  investmentHoldings: many(investmentHoldings),
  liabilityDetails: many(liabilityDetails),
}))

export const categoryGroupsRelations = relations(categoryGroups, ({ one, many }) => ({
  user: one(users, { fields: [categoryGroups.userId], references: [users.id] }),
  categories: many(categories),
}))

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  user: one(users, { fields: [categories.userId], references: [users.id] }),
  group: one(categoryGroups, {
    fields: [categories.groupId],
    references: [categoryGroups.id],
  }),
  ccAccount: one(accounts, {
    fields: [categories.ccAccountId],
    references: [accounts.id],
  }),
  monthBudgets: many(monthBudgets),
  transactions: many(transactions),
  payeeRules: many(payeeRules),
}))

export const monthBudgetsRelations = relations(monthBudgets, ({ one }) => ({
  user: one(users, { fields: [monthBudgets.userId], references: [users.id] }),
  category: one(categories, {
    fields: [monthBudgets.categoryId],
    references: [categories.id],
  }),
}))

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
}))

export const importConnectionsRelations = relations(importConnections, ({ one }) => ({
  user: one(users, { fields: [importConnections.userId], references: [users.id] }),
  account: one(accounts, {
    fields: [importConnections.accountId],
    references: [accounts.id],
  }),
}))

export const payeeRulesRelations = relations(payeeRules, ({ one }) => ({
  user: one(users, { fields: [payeeRules.userId], references: [users.id] }),
  category: one(categories, { fields: [payeeRules.categoryId], references: [categories.id] }),
}))

export const investmentHoldingsRelations = relations(investmentHoldings, ({ one }) => ({
  user: one(users, { fields: [investmentHoldings.userId], references: [users.id] }),
  account: one(accounts, { fields: [investmentHoldings.accountId], references: [accounts.id] }),
}))

export const liabilityDetailsRelations = relations(liabilityDetails, ({ one }) => ({
  user: one(users, { fields: [liabilityDetails.userId], references: [users.id] }),
  account: one(accounts, { fields: [liabilityDetails.accountId], references: [accounts.id] }),
}))

export const aiConversationsRelations = relations(aiConversations, ({ one, many }) => ({
  user: one(users, { fields: [aiConversations.userId], references: [users.id] }),
  messages: many(aiMessages),
}))

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
  user: one(users, { fields: [aiMessages.userId], references: [users.id] }),
  conversation: one(aiConversations, { fields: [aiMessages.conversationId], references: [aiConversations.id] }),
}))

export const aiRecommendationsRelations = relations(aiRecommendations, ({ one }) => ({
  user: one(users, { fields: [aiRecommendations.userId], references: [users.id] }),
}))

export const aiAuditEventsRelations = relations(aiAuditEvents, ({ one }) => ({
  user: one(users, { fields: [aiAuditEvents.userId], references: [users.id] }),
}))
