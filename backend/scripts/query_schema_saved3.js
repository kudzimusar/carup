import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) });
async function run() {
  await client.connect();
  const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'vehicle_ownership_history'");
  console.log('vehicle_ownership_history:', res.rows.map(r => r.column_name));
  await client.end();
}
run();
