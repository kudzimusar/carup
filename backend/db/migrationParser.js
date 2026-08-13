/**
 * Canonical migration parser and integrity contract.
 *
 * WHY THIS EXISTS
 * ---------------
 * The repository grew several independent migration parsers with DIVERGENT
 * semantics for the same file. For a file carrying no `-- +migrate Up` marker:
 *
 *   · backend/db/migrate.js          SKIPPED it, did not record it, and still
 *                                    reported "All pending migrations applied
 *                                    successfully" — a false success.
 *   · database/test/migration_pglite_check.mjs and the dispatcher runners
 *                                    executed the WHOLE FILE as the Up section.
 *
 * One artifact therefore meant "do nothing" to one runner and "run everything"
 * to another. This module is the single place that decides, and it FAILS LOUD
 * rather than guessing.
 *
 * LEDGER NOTE (deliberate, do not "fix"): the canonical Postgres ledger for this
 * project is `supabase_migrations.schema_migrations`. This module does not create,
 * read, or write any ledger — it only parses. `backend/db/migrate.js` maintains a
 * LOCAL SQLite table named `schema_migrations` inside backend/db/carup.db; that is
 * a SQLite file, not `public.schema_migrations` in Postgres, and it is never
 * created against a Postgres database.
 *
 * VERSION CONTRACT: the version of a migration is its FULL FILENAME, matching the
 * documented runner truth. Timestamp prefixes are NOT versions — several are
 * legitimately shared by more than one file (see KNOWN_TIMESTAMP_PREFIX_COLLISIONS).
 */

import { createHash } from 'node:crypto';

/** Thrown for every integrity violation. Never caught-and-continued by the runner. */
export class MigrationIntegrityError extends Error {
  constructor(code, file, detail) {
    super(`[migration-integrity] ${code} in ${file}: ${detail}`);
    this.name = 'MigrationIntegrityError';
    this.code = code;
    this.file = file;
  }
}

/**
 * Files that live in database/migrations/ but are NOT executable migrations.
 *
 * This is an explicit, enumerated allowlist with a stated reason per entry —
 * deliberately not a pattern or a try/catch — so it cannot silently become an
 * escape hatch for a genuinely broken migration. Adding an entry is a reviewable
 * change; a new marker-less migration fails instead of being quietly exempted.
 */
export const NON_MIGRATION_FILES = Object.freeze({
  'supabase_schema.sql':
    'Full schema snapshot/dump used for reference and bootstrapping, not a versioned migration.',
});

/**
 * Timestamp prefixes shared by more than one migration file as of the integrity
 * closure. These are historical and harmless BECAUSE the version is the full
 * filename. Frozen here so a NEW collision is caught by the regression test
 * rather than discovered in an environment.
 */
export const KNOWN_TIMESTAMP_PREFIX_COLLISIONS = Object.freeze([
  '002',
  '013',
  '014',
  '20260621120000',
  '20260621130000',
  '20260621140000',
  '20260624120000',
  '20260626120000',
]);

/**
 * GOVERNED EXCEPTION — production-applied migrations that carry no Up marker and
 * whose bytes are pinned by a COMMITTED PRODUCTION RECEIPT.
 *
 * Adding the marker to these files would change their sha256 and orphan the
 * receipt that proves what was actually executed against production. The lane
 * rule is therefore: leave the historical artifact intact and govern the
 * exception here.
 *
 * This is NOT a hole in the contract. Each entry pins the exact sha256 that the
 * receipt records, and parsing verifies it — if the bytes ever change, parsing
 * FAILS with PROVENANCE_PIN_BROKEN rather than quietly accepting the new file.
 * The whole file is the Up section, which is precisely the semantics under which
 * these were applied (the dispatcher and PGlite parsers already treat a
 * marker-less file that way).
 *
 * Retiring an entry requires re-issuing its production receipt, not editing here.
 */
export const PROVENANCE_PINNED_UNMARKED = Object.freeze({
  '20260618040000_verification_case_management.sql': {
    sha256: 'bec9f67a3c0fc4abc1bd9ae09cf88cfd8492dfdee2b920320026713a583ab2b6',
    receipt: 'docs/releases/PHASE_7C_PRODUCTION_COMPLETION_REPORT.md:11 (production 2026-07-14)',
  },
  '20260618050000_verification_evidence_trust_columns.sql': {
    sha256: '0e19346e959c0a6ceb6fb4361990886d4efdfa26daf7a85f343410fbc6b4bed4',
    receipt: 'docs/releases/PHASE_7C_PRODUCTION_COMPLETION_REPORT.md:12 (production 2026-07-14)',
  },
  '20260619201406_production_access_containment.sql': {
    sha256: '9e85e828bb3c5f4f1e7ee70bcc55a8490c0d13137b1afeda7c7f62eb15717fbe',
    receipt: 'docs/DIASPORA_TRADE_OS_MIGRATION_LEDGER.md:83 + docs/marketplace/MARKETPLACE_V1_MVP_CLOSEOUT.md:95 (production 2026-07-26)',
  },
  '20260620232827_issue77_access_containment_followup.sql': {
    sha256: '0cf27ad5399d793c1b2fe9878a2c36ee8dbc3bcbb9aaff2327eea438f1788b6e',
    receipt: 'docs/DIASPORA_TRADE_OS_MIGRATION_LEDGER.md:85 + docs/marketplace/MARKETPLACE_V1_MVP_CLOSEOUT.md:96 (production 2026-07-26)',
  },
});

export function isProvenancePinned(file) {
  return Object.prototype.hasOwnProperty.call(PROVENANCE_PINNED_UNMARKED, file);
}

/**
 * RETIRED — migrations that are superseded AND cannot execute successfully against
 * any database that already carries the shape which actually won.
 *
 * These must never be armed. Giving such a file an Up marker would convert a
 * historically-silent skip into a hard runtime failure, which is not a repair.
 * They are excluded from the apply set by name, with the reason recorded here.
 */
export const RETIRED_UNAPPLIABLE = Object.freeze({
  '009_phase4_schema.sql':
    'Superseded by 008_domain3.sql, which won the CREATE TABLE IF NOT EXISTS race for ' +
    'registry_verifications and compliance_reports. Live staging shows the 008 shape ' +
    '(registry_verifications = id, vin, status, checked_by, notes, created_at), so this file\'s ' +
    '`CREATE INDEX ... ON registry_verifications(tenant_id)` and `ON compliance_reports(tenant_id)` ' +
    'would raise 42703 (column does not exist). Its mechanic_* CREATE TABLE IF NOT EXISTS blocks are ' +
    'already dead no-ops against the 006_domain1.sql shape. Unappliable as written — retire, do not repair.',
});

export function isRetiredMigration(file) {
  return Object.prototype.hasOwnProperty.call(RETIRED_UNAPPLIABLE, file);
}

function sha256Of(text) {
  return createHash('sha256').update(text).digest('hex');
}

const UP_MARKER = '-- +migrate Up';
const DOWN_MARKER = '-- +migrate Down';

/** All start offsets of a line that is exactly `marker` (trailing blanks allowed). */
function markerOffsets(sql, marker) {
  const re = new RegExp(`^${marker.replace(/[+\\]/g, '\\$&')}[^\\S\\r\\n]*$`, 'gm');
  const offsets = [];
  for (const m of sql.matchAll(re)) offsets.push({ start: m.index, end: m.index + m[0].length });
  return offsets;
}

export function isNonMigrationFile(file) {
  return Object.prototype.hasOwnProperty.call(NON_MIGRATION_FILES, file);
}

/**
 * Parse a migration into its Up and Down sections, or throw.
 *
 * Failure modes (all hard errors — never a warning, never a skip):
 *   MISSING_UP_MARKER      no `-- +migrate Up` line at all
 *   DUPLICATE_UP_MARKER    more than one `-- +migrate Up`
 *   DUPLICATE_DOWN_MARKER  more than one `-- +migrate Down`
 *   DOWN_BEFORE_UP         `-- +migrate Down` precedes `-- +migrate Up`
 *   EMPTY_UP_SECTION       marker present but the extracted Up body is blank
 *   NON_MIGRATION_FILE     caller tried to execute an enumerated non-migration
 */
export function parseMigrationSource(sql, file = '<unknown>') {
  if (typeof sql !== 'string') {
    throw new MigrationIntegrityError('INVALID_SOURCE', file, 'migration source is not a string');
  }
  if (isNonMigrationFile(file)) {
    throw new MigrationIntegrityError(
      'NON_MIGRATION_FILE',
      file,
      `${NON_MIGRATION_FILES[file]} It must never be executed as a migration.`,
    );
  }
  if (isRetiredMigration(file)) {
    throw new MigrationIntegrityError('RETIRED_MIGRATION', file, RETIRED_UNAPPLIABLE[file]);
  }

  // Governed exception: production-applied, receipt-pinned, marker-less by design.
  // The pin is verified on every parse, so this path cannot mask a drifted file.
  if (isProvenancePinned(file)) {
    const pin = PROVENANCE_PINNED_UNMARKED[file];
    const actual = sha256Of(sql);
    if (actual !== pin.sha256) {
      throw new MigrationIntegrityError(
        'PROVENANCE_PIN_BROKEN',
        file,
        `bytes changed: sha256 ${actual} != pinned ${pin.sha256}. This artifact is pinned by a ` +
          `committed production receipt (${pin.receipt}). Editing it orphans that receipt — ` +
          're-issue the receipt deliberately instead of changing the file.',
      );
    }
    const body = sql.trim();
    if (body === '') {
      throw new MigrationIntegrityError('EMPTY_UP_SECTION', file, 'provenance-pinned migration is empty.');
    }
    return { up: body, down: '', governedException: true };
  }

  const ups = markerOffsets(sql, UP_MARKER);
  const downs = markerOffsets(sql, DOWN_MARKER);

  if (ups.length === 0) {
    throw new MigrationIntegrityError(
      'MISSING_UP_MARKER',
      file,
      `no "${UP_MARKER}" marker found. Every executable migration must declare its Up section ` +
        'explicitly; a marker-less file is ambiguous across runners and is refused.',
    );
  }
  if (ups.length > 1) {
    throw new MigrationIntegrityError(
      'DUPLICATE_UP_MARKER',
      file,
      `found ${ups.length} "${UP_MARKER}" markers; exactly one is required.`,
    );
  }
  if (downs.length > 1) {
    throw new MigrationIntegrityError(
      'DUPLICATE_DOWN_MARKER',
      file,
      `found ${downs.length} "${DOWN_MARKER}" markers; at most one is allowed.`,
    );
  }
  if (downs.length === 1 && downs[0].start < ups[0].start) {
    throw new MigrationIntegrityError(
      'DOWN_BEFORE_UP',
      file,
      `"${DOWN_MARKER}" appears before "${UP_MARKER}"; boundaries are malformed.`,
    );
  }

  const upBody = sql.slice(ups[0].end, downs.length === 1 ? downs[0].start : sql.length).trim();
  if (upBody === '') {
    throw new MigrationIntegrityError(
      'EMPTY_UP_SECTION',
      file,
      'the Up section is empty. An empty Up cannot be distinguished from a broken file and is refused.',
    );
  }

  const downBody = downs.length === 1 ? sql.slice(downs[0].end).trim() : '';
  return { up: upBody, down: downBody };
}

/** The canonical version of a migration: its full filename. */
export function deriveVersion(file) {
  if (typeof file !== 'string' || file.trim() === '') {
    throw new MigrationIntegrityError('INVALID_VERSION', String(file), 'migration filename is empty');
  }
  return file;
}

/** Leading numeric timestamp/sequence prefix, or null when the name has none. */
export function timestampPrefixOf(file) {
  const m = /^(\d+)_/.exec(file);
  return m ? m[1] : null;
}

/**
 * Refuse a migration set whose versions are not deterministic.
 * Duplicate full filenames are unrepresentable on a filesystem but ARE
 * representable in a hand-authored manifest, which is exactly where an
 * ambiguous apply order would silently arise.
 */
export function assertDeterministicVersions(files) {
  const seen = new Map();
  for (const file of files) {
    const version = deriveVersion(file);
    if (seen.has(version)) {
      throw new MigrationIntegrityError(
        'AMBIGUOUS_VERSION',
        file,
        `version "${version}" is claimed by more than one entry; apply order and ledger identity ` +
          'would be ambiguous.',
      );
    }
    seen.set(version, file);
  }
  return true;
}

/** Timestamp prefixes shared by 2+ files in `files`, sorted. */
export function findTimestampPrefixCollisions(files) {
  const byPrefix = new Map();
  for (const file of files) {
    const prefix = timestampPrefixOf(file);
    if (!prefix) continue;
    byPrefix.set(prefix, (byPrefix.get(prefix) || 0) + 1);
  }
  return [...byPrefix.entries()].filter(([, n]) => n > 1).map(([p]) => p).sort();
}
