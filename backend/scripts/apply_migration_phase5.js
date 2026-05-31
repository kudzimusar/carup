import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
const { Client } = pg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function applyMigration() {
  const client = new Client({
    connectionString: 'postgresql://postgres:[ROTATED-SEE-CR1]@db.vhmnajoeicasaigiophh.supabase.co:5432/postgres'
  })

  try {
    await client.connect()
    console.log('Connected to Supabase PostgreSQL')

    const sqlPath = path.join(__dirname, '../../database/migrations/010_phase5_schema.sql')
    const sql = fs.readFileSync(sqlPath, 'utf8')

    await client.query(sql)
    console.log('Phase 5 migration applied successfully!')

  } catch (error) {
    console.error('Migration failed:', error)
  } finally {
    await client.end()
  }
}

applyMigration()
