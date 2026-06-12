import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load env variables
dotenv.config();

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DIRECT_URL or DATABASE_URL environment variable is required.');
}

const client = new pg.Client({
  connectionString: connectionString.replace('?pgbouncer=true', ''), // Ensure direct connection
});

async function runMigration() {
  try {
    const migrationPath = path.resolve('database/migrations/014_passport_evidence_architecture.sql');
    console.log(`📖 Reading migration file from: ${migrationPath}`);
    let sql = fs.readFileSync(migrationPath, 'utf8');

    // Remove "+migrate Up" if it's there
    sql = sql.replace('-- +migrate Up', '');
    // Split into up/down if there's any down part, but since Down is at the end we can just split or execute up to "-- +migrate Down"
    const downIndex = sql.indexOf('-- +migrate Down');
    if (downIndex !== -1) {
      sql = sql.substring(0, downIndex);
    }

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
