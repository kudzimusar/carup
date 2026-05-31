import pg from 'pg';

const connectionString = 'postgresql://postgres.vhmnajoeicasaigiophh:[ROTATED-SEE-CR1]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

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
