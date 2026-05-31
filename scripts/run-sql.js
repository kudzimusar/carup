import pg from 'pg';
import fs from 'fs';
import path from 'path';

const connectionString = 'postgresql://postgres.vhmnajoeicasaigiophh:HVYbYVb1x2ErqzH4@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

const client = new pg.Client({
  connectionString,
});

async function runMigration() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL via Direct Pooler URL.');
    
    const schemaPath = path.resolve('./database/migrations/002_multi_tenant_and_auth_schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('Running Agent 1 & Agent 2 schema migration...');
    await client.query(sql);
    console.log('✅ Schema migration completed successfully.');
    
  } catch (err) {
    console.error('❌ Error during migration:', err);
  } finally {
    await client.end();
  }
}

runMigration();
