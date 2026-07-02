import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load env variables
dotenv.config();

const connectionString = process.env.SUPABASE_DB_URL || (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);

const client = new pg.Client({
  connectionString,
});

async function runMigration() {
  try {
    const migrationPath = path.resolve('database/migrations/013_zimbabwe_plate_and_owner_privacy.sql');
    console.log(`📖 Reading migration file from: ${migrationPath}`);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await client.connect();
    console.log('📡 Connected successfully to Supabase PostgreSQL Database.');

    console.log('🤖 Running migration 013_zimbabwe_plate_and_owner_privacy.sql...');
    await client.query(sql);
    console.log('✅ Migration 013 applied successfully.');
  } catch (err) {
    console.error('❌ Migration deployment failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
