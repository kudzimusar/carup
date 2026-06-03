import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load env variables
dotenv.config();

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL || 'postgresql://postgres.vhmnajoeicasaigiophh:[ROTATED-SEE-CR1]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

const client = new pg.Client({
  connectionString: connectionString.replace('?pgbouncer=true', ''), // Ensure direct connection
});

async function runMigration() {
  try {
    const migrationPath = path.resolve('database/migrations/014_passport_evidence_architecture.sql');
    console.log(`📖 Reading migration file from: ${migrationPath}`);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await client.connect();
    console.log('📡 Connected successfully to Supabase PostgreSQL Database.');

    console.log('🤖 Running migration 014_passport_evidence_architecture.sql...');
    await client.query(sql);
    console.log('✅ Migration 014 applied successfully.');
  } catch (err) {
    console.error('❌ Migration deployment failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
