import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './database.js';
import {
  assertDeterministicVersions,
  isNonMigrationFile,
  isRetiredMigration,
  NON_MIGRATION_FILES,
  RETIRED_UNAPPLIABLE,
  parseMigrationSource,
} from './migrationParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../database/migrations');

// Parse a migration file into its UP and DOWN SQL segments.
//
// Delegates to the canonical parser, which THROWS on a missing/duplicate/empty
// Up section and on malformed boundaries. It previously returned `up: ''` for a
// marker-less file, which the runner then skipped silently while still reporting
// overall success. Integrity violations must stop the run.
function parseMigration(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return parseMigrationSource(content, path.basename(filePath));
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
  
  const allSqlFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Lexicographical sort ensures correct execution order

  // Enumerated non-migrations (e.g. the full schema dump) are excluded up front and
  // named in the log, so an exclusion is always visible and never inferred from a
  // parse failure.
  const files = allSqlFiles.filter(f => !isNonMigrationFile(f) && !isRetiredMigration(f));
  for (const file of allSqlFiles.filter(isNonMigrationFile)) {
    console.log(`  ⏭️  Excluded non-migration ${file} — ${NON_MIGRATION_FILES[file]}`);
  }
  for (const file of allSqlFiles.filter(isRetiredMigration)) {
    console.log(`  ⏭️  Excluded RETIRED migration ${file} — ${RETIRED_UNAPPLIABLE[file]}`);
  }

  // Ambiguous versions would make apply order and ledger identity non-deterministic.
  assertDeterministicVersions(files);

  if (action === 'up') {
    console.log('🤖 Running pending migrations...');
    let appliedCount = 0;
    for (const file of files) {
      const alreadyApplied = await db.get('SELECT 1 FROM schema_migrations WHERE version = ?', [file]);
      if (alreadyApplied) {
        continue;
      }

      console.log(`  ➔ Applying UP migration: ${file}`);
      // Throws MigrationIntegrityError on a missing/empty Up section or malformed
      // boundaries. Deliberately NOT caught: a migration that cannot be parsed is a
      // hard failure, not a skip.
      const { up } = parseMigration(path.join(migrationsDir, file));

      // Execute within transaction for rollback safety
      await db.run('BEGIN TRANSACTION;');
      try {
        await db.exec(up);
        await db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [file, new Date().toISOString()]);
        await db.run('COMMIT;');
        appliedCount += 1;
        console.log(`    ✅ Successfully applied ${file}`);
      } catch (err) {
        await db.run('ROLLBACK;');
        console.error(`    ❌ Failed to apply migration ${file}. Rolled back transaction. Error:`, err.message);
        throw err;
      }
    }
    // Only reachable when every non-excluded migration either was already recorded
    // or was applied and recorded just now — nothing is skipped on this path.
    console.log(`🎉 All pending migrations applied successfully (${appliedCount} applied this run).`);
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
