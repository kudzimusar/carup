import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../database/migrations');

// Helper to parse migration files into UP and DOWN SQL segments
function parseMigration(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const upMatch = content.match(/-- \+migrate Up([\s\S]*?)(?:-- \+migrate Down|$)/);
  const downMatch = content.match(/-- \+migrate Down([\s\S]*?)$/);
  
  return {
    up: upMatch ? upMatch[1].trim() : '',
    down: downMatch ? downMatch[1].trim() : ''
  };
}

export async function runMigrations(action = 'up') {
  const db = await getDb();
  
  // Ensure migration tracking table exists
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  
  // Read all migration files
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory does not exist at: ${migrationsDir}`);
  }
  
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Lexicographical sort ensures correct execution order
    
  if (action === 'up') {
    console.log('🤖 Running pending migrations...');
    for (const file of files) {
      const alreadyApplied = await db.get('SELECT 1 FROM schema_migrations WHERE version = ?', [file]);
      if (alreadyApplied) {
        continue;
      }
      
      console.log(`  ➔ Applying UP migration: ${file}`);
      const { up } = parseMigration(path.join(migrationsDir, file));
      
      if (!up) {
        console.warn(`    ⚠️ Warning: No Up section found in migration ${file}`);
        continue;
      }
      
      // Execute within transaction for rollback safety
      await db.run('BEGIN TRANSACTION;');
      try {
        await db.exec(up);
        await db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [file, new Date().toISOString()]);
        await db.run('COMMIT;');
        console.log(`    ✅ Successfully applied ${file}`);
      } catch (err) {
        await db.run('ROLLBACK;');
        console.error(`    ❌ Failed to apply migration ${file}. Rolled back transaction. Error:`, err.message);
        throw err;
      }
    }
    console.log('🎉 All pending migrations applied successfully.');
  } else if (action === 'rollback') {
    console.log('🤖 Rolling back the last applied migration...');
    const lastApplied = await db.get('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
    
    if (!lastApplied) {
      console.log('    ℹ️ No migrations found to rollback.');
      return;
    }
    
    const file = lastApplied.version;
    console.log(`  ➔ Rolling back migration: ${file}`);
    
    const { down } = parseMigration(path.join(migrationsDir, file));
    if (!down) {
      console.warn(`    ⚠️ Warning: No Down section found in migration ${file}. Deleting migration row only.`);
    }
    
    await db.run('BEGIN TRANSACTION;');
    try {
      if (down) {
        await db.exec(down);
      }
      await db.run('DELETE FROM schema_migrations WHERE version = ?', [file]);
      await db.run('COMMIT;');
      console.log(`    ✅ Successfully rolled back ${file}`);
    } catch (err) {
      await db.run('ROLLBACK;');
      console.error(`    ❌ Failed to rollback migration ${file}. Rolled back transaction. Error:`, err.message);
      throw err;
    }
  } else {
    throw new Error(`Unknown migration action: ${action}`);
  }
}

// Handle execution if run directly from command line
const args = process.argv.slice(2);
if (args.includes('--up') || args.includes('up')) {
  runMigrations('up')
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
} else if (args.includes('--rollback') || args.includes('rollback')) {
  runMigrations('rollback')
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
