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
      SELECT trigger_name, event_object_table
      FROM information_schema.triggers
      WHERE trigger_schema = 'public';
    `);

    console.log('Found triggers:');
    if (res.rows.length === 0) {
      console.log('None.');
    } else {
      res.rows.forEach(row => {
        console.log(`- ${row.trigger_name} on table ${row.event_object_table}`);
      });
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main();
