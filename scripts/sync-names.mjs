import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

// Sync all CC payment category names to match current account names
const result = await sql`
  UPDATE categories
  SET name = a.name
  FROM accounts a
  WHERE categories.cc_account_id = a.id
    AND categories.name != a.name
  RETURNING categories.id, a.name as new_name
`;
console.log('Updated:', result.length, 'categories');
for (const r of result) console.log(' ->', r.id, r.new_name);
