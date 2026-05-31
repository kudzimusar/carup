import pg from 'pg';

const connectionString = 'postgresql://postgres.vhmnajoeicasaigiophh:[ROTATED-SEE-CR1]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

const client = new pg.Client({ connectionString });

async function check() {
  try {
    await client.connect();
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'listing_images';
    `);
    console.log('Columns in listing_images:');
    res.rows.forEach(r => console.log(` - ${r.column_name} (${r.data_type})`));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

check();
