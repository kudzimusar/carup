import pg from 'pg';

const connectionString = 'postgresql://postgres.vhmnajoeicasaigiophh:HVYbYVb1x2ErqzH4@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

async function checkSchemas() {
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  
  const tablesToCheck = [
    'zimra_declarations',
    'cvr_ownership_records',
    'vid_inspections',
    'cid_clearance_records',
    'zinara_licensing_records',
    'ocr_national_ids',
    'ocr_registration_books',
    'ocr_customs_declarations',
    'administrative_overrides'
  ];
  
  try {
    console.log('🔍 Querying Postgres information_schema for deployed tables...\n');
    
    for (const table of tablesToCheck) {
      const res = await client.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = $1 
        ORDER BY ordinal_position;
      `, [table]);
      
      if (res.rows.length === 0) {
        console.log(`❌ Table "${table}" does not exist!`);
      } else {
        console.log(`📋 Table: "${table}" (${res.rows.length} columns)`);
        for (const col of res.rows) {
          console.log(`   ➔ ${col.column_name}: ${col.data_type} (Nullable: ${col.is_nullable})`);
        }
        console.log('');
      }
    }
  } catch (err) {
    console.error('Error querying schema details:', err);
  } finally {
    await client.release();
    await pool.end();
  }
}

checkSchemas();
