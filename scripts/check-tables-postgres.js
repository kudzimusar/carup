import pg from 'pg';

const connectionString = 'postgresql://postgres.vhmnajoeicasaigiophh:[ROTATED-SEE-CR1]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

const client = new pg.Client({
  connectionString,
});

async function check() {
  try {
    await client.connect();
    const res = await client.query(`
      SELECT table_name, table_schema 
      FROM information_schema.tables 
      WHERE table_name IN ('domain_events', 'payment_transactions', 'currency_rates');
    `);
    console.log('Phase 6 tables found:');
    res.rows.forEach(r => console.log(` - ${r.table_schema}.${r.table_name}`));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

check();
