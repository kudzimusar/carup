import fs from 'fs';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:HVYbYVb1x2ErqzH4@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres' // Trying standard connection string. Actually the user provided this one: postgresql://postgres:HVYbYVb1x2ErqzH4@db.vhmnajoeicasaigiophh.supabase.co:5432/postgres
});

const clientReal = new Client({
    connectionString: 'postgresql://postgres:HVYbYVb1x2ErqzH4@db.vhmnajoeicasaigiophh.supabase.co:5432/postgres'
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
