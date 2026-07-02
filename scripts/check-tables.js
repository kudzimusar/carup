import pg from 'pg';

const connectionString = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);

const client = new pg.Client({
  connectionString,
});

async function main() {
  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL!');

    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log('Found tables:');
    res.rows.forEach(row => {
      console.log(`- ${row.table_name}`);
    });
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main();
