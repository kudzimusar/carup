import pg from 'pg';
import fs from 'fs';
import path from 'path';

const connectionString = 'postgresql://postgres:HVYbYVb1x2ErqzH4@db.vhmnajoeicasaigiophh.supabase.co:5432/postgres';

const client = new pg.Client({
  connectionString,
});

async function runMigration() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL.');
    
    const schemaPath = path.resolve('./database/migrations/supabase_schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('Running schema SQL...');
    await client.query(sql);
    console.log('Schema migration completed successfully.');
    
  } catch (err) {
    console.error('Error during migration:', err);
  } finally {
    await client.end();
  }
}

runMigration();
