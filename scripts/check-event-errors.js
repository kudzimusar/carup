import pg from 'pg';

const connectionString = 'postgresql://postgres.vhmnajoeicasaigiophh:HVYbYVb1x2ErqzH4@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

async function check() {
  const pool = new pg.Pool({ connectionString });
  const db = await pool.connect();
  
  try {
    const res = await db.query("SELECT event_type, status, attempts, error_log FROM domain_events ORDER BY created_at DESC LIMIT 3;");
    res.rows.forEach((r, idx) => {
      console.log(`Event #${idx + 1}: ${r.event_type} | Status: ${r.status} | Attempts: ${r.attempts}`);
      console.log(`Error Log:\n${r.error_log || 'None'}`);
      console.log('-'.repeat(40));
    });
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
