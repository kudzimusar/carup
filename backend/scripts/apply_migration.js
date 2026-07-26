import fs from 'fs';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;

// CR-1: this script fails closed — it never embeds or falls back to any hardcoded database URL.
const CONNECTION_STRING = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!CONNECTION_STRING) {
  console.error('SUPABASE_DB_URL or DATABASE_URL is required; refusing to run without an explicit target.');
  process.exit(2);
}

const client = new Client({
  connectionString: CONNECTION_STRING
});

const clientReal = new Client({
    connectionString: CONNECTION_STRING
})

async function runMigration() {
  await clientReal.connect();
  const sqlPath = path.resolve(__dirname, '../../database/migrations/008_domain3.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Applying migration...');
  await clientReal.query(sql);
  console.log('Migration applied successfully.');
  await clientReal.end();
}

runMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
