import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres:[ROTATED-SEE-CR1]@db.vhmnajoeicasaigiophh.supabase.co:5432/postgres' });
async function run() {
  await client.connect();
  const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'vehicles'");
  console.log('vehicles:', res.rows.map(r => r.column_name));
  
  const res2 = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'mechanic_work_orders'");
  console.log('mechanic_work_orders:', res2.rows.map(r => r.column_name));
  await client.end();
}
run();
