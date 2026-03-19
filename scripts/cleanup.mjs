import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

// Check Transfers group and its categories
const transferGroups = await sql`
  SELECT g.id, g.name, g.user_id, g.is_transfer, g.is_system,
         COUNT(c.id) as cat_count
  FROM category_groups g
  LEFT JOIN categories c ON c.group_id = g.id
  WHERE g.is_transfer = true AND g.is_system = false
  GROUP BY g.id
`;
console.log('Legacy transfer groups:', JSON.stringify(transferGroups, null, 2));

// Check CC Payment categories vs account names (are they in sync?)
const ccSync = await sql`
  SELECT a.name as account_name, cat.name as category_name, cat.id as cat_id
  FROM categories cat
  JOIN accounts a ON a.id = cat.cc_account_id
  WHERE cat.cc_account_id IS NOT NULL
`;
console.log('CC name sync check:', JSON.stringify(ccSync, null, 2));
