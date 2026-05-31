import pg from 'pg';
import fs from 'fs';
import path from 'path';

const connectionString = 'postgresql://postgres.vhmnajoeicasaigiophh:[ROTATED-SEE-CR1]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

const client = new pg.Client({
  connectionString,
});

async function runMigration() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL database on Supabase.');
    
    const schemaPath = path.resolve('./database/migrations/011_phase6_schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('Running Phase 6 schema migration (domain_events, payment_transactions, currency_rates)...');
    await client.query(sql);
    console.log('✅ Phase 6 schema migration completed successfully.');
    
  } catch (err) {
    console.error('❌ Error applying Phase 6 migration:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
