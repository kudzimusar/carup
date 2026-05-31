import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres:[ROTATED-SEE-CR1]@db.vhmnajoeicasaigiophh.supabase.co:5432/postgres' });
async function run() {
  await client.connect();
  const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'vehicle_ownership_history'");
  console.log('vehicle_ownership_history:', res.rows.map(r => r.column_name));
  await client.end();
}
run();
