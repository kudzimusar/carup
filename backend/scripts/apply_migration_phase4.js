import fs from 'fs';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;

const clientReal = new Client({
    connectionString: 'postgresql://postgres:HVYbYVb1x2ErqzH4@db.vhmnajoeicasaigiophh.supabase.co:5432/postgres'
})

async function runMigration() {
  await clientReal.connect();
  const sqlPath = path.resolve(__dirname, '../../database/migrations/009_phase4_schema.sql');
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
