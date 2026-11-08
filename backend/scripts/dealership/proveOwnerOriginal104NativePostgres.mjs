/**
 * CARUP-DEALER-ONB-001-LR01-R4 P0-1: PRIVATE import of the Owner's ORIGINAL 20-tab XLSX
 * into an EMPTY, dedicated, loopback-only native PostgreSQL database, with physical readback.
 *
 * This is NOT a CI script. The original workbook holds real researched businesses and
 * restricted contact facts: it must never be committed, uploaded to CI, screenshotted or logged.
 * The script therefore prints ONLY aggregate evidence (counts, categories, cities, digests),
 * and refuses to print anything if a restricted source value would appear in its output.
 *
 * What it proves (all on the exact original bytes, SHA-256 a9a6ac6f…4b137):
 *  1. The bytes are the Owner-original workbook (never a Google re-export, never synthetic).
 *  2. The target is the dedicated empty loopback DB (no tenant/org/profile/claim/public row).
 *  3. The existing secure importer (commitCandidatesLocal) inserts 104 rows; every stored
 *     field is read back and compared with the parsed source, row by row.
 *  4. Every row's seed ID, original row, category and city equal the committed public-safe
 *     manifest that earlier reconciliation derived from the same SHA.
 *  5. Category counts and the D0/D4 grouping/collision signals are recomputed FROM THE DATABASE.
 *  6. Re-import is an idempotent no-op (104 identical); an altered row is rejected and rolled back.
 *  7. Zero public profile, legal profile, tenant, organization or claim is created.
 *
 * Usage (from a space-free checkout; the workbook path is passed explicitly, never fetched):
 *   DEALER_SEED_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/carup_dealer_owner_original_isolated \
 *     node backend/scripts/dealership/proveOwnerOriginal104NativePostgres.mjs '/private/path/original.xlsx' \
 *     --expect-sha256=a9a6ac6f68bed5266c6870958520105fc1c69f75dd80f7020839e8d5fdd4b137
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import pg from 'pg';
import {
  ORIGINAL_OWNER_SOURCE_SHA256,
  ORIGINAL_OWNER_DISPOSABLE_DATABASE,
  ORIGINAL_HEADERS,
  parseResearchWorkbook,
  analyzeResearchIdentitySignals,
  assertOriginalImportTarget,
  assertOriginalOwnerSourceSha,
  assertEmptyOriginalImportTarget,
  commitCandidatesLocal,
} from './importResearchSeed.mjs';

const fail = (message) => { throw new Error('DEALER_ORIGINAL_104_NATIVE_FAIL ' + message); };

// Restricted research facts: never printed, even when they look harmless.
export const RESTRICTED_SOURCE_FIELDS = Object.freeze([
  'Dealer / Company Name', 'Brands / Specialization', 'Physical Address', 'Suburb / Area',
  'Phone / WhatsApp', 'Email', 'Ownership / Parent Company / Key Principal', 'Website / Source URL',
]);

/**
 * Refuse to emit evidence that contains any restricted value (case-insensitive, length >= 4 so a
 * blank or a two-letter token cannot cause a false refusal). A restricted cell whose ENTIRE value
 * is one of the already-public-safe tokens (a manifest city or category — e.g. a suburb recorded as
 * its own city name) discloses nothing new and is exempt; every other value stays strict.
 * Returns the number of values checked.
 */
// A bare generic word identifies nobody. 'private' is exactly the token the importer's own
// grouping analysis already ignores as "not a group" (analyzeResearchIdentitySignals).
export const GENERIC_NON_IDENTIFYING_VALUES = Object.freeze(['private']);

export function assertNoRestrictedValues(outputText, records, publicSafeTokens = new Set()) {
  const haystack = String(outputText).toLocaleLowerCase('en');
  const safe = new Set([...publicSafeTokens, ...GENERIC_NON_IDENTIFYING_VALUES]
    .map((t) => String(t).trim().toLocaleLowerCase('en')));
  let checked = 0;
  for (const record of records) {
    for (const field of RESTRICTED_SOURCE_FIELDS) {
      const value = String(record.source_snapshot?.[field] ?? '').trim().toLocaleLowerCase('en');
      if (value.length < 4 || safe.has(value)) continue;
      checked += 1;
      if (haystack.includes(value)) {
        fail('evidence output would disclose a restricted source value (' + field + ' of ' + record.seed_dealer_id + ')');
      }
    }
  }
  return checked;
}

export function aggregateDigest(rows) {
  const lines = rows.map((r) => r.seed_dealer_id + ':' + r.source_row_sha256).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

async function main() {
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DEALER_ISOLATED_POSTGRES_URL', 'GITHUB_ACTIONS', 'CI']) {
    if (process.env[key]) fail('refusing to run with ' + key + ' set: the original source never enters CI or a shared runtime');
  }
  const args = process.argv.slice(2);
  const filePath = args.find((arg) => !arg.startsWith('--'));
  const expected = args.find((arg) => arg.startsWith('--expect-sha256='))?.split('=')[1];
  if (!filePath) fail('provide the explicit private path of the Owner-original XLSX');
  const dbUrl = assertOriginalImportTarget(process.env.DEALER_SEED_DATABASE_URL);

  const bytes = await readFile(path.resolve(filePath));
  const hash = createHash('sha256').update(bytes).digest('hex');
  assertOriginalOwnerSourceSha(hash, expected);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const { records, summary } = parseResearchWorkbook(workbook, hash);
  assert.equal(records.length, 104);

  const manifestPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures', 'dealer_source_104_safe_manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.original_source_sha256, ORIGINAL_OWNER_SOURCE_SHA256, 'manifest must describe the same original bytes');
  assert.equal(manifest.rows.length, 104);
  for (const [i, row] of manifest.rows.entries()) {
    const record = records[i];
    assert.equal(record.seed_dealer_id, row.seed_id, 'manifest seed order ' + i);
    assert.equal(record.original_source_row, row.row, 'manifest source row ' + row.seed_id);
    assert.equal(record.proposed_source_category, row.category, 'manifest category ' + row.seed_id);
    assert.equal(record.source_snapshot['City / Town'], row.city, 'manifest city ' + row.seed_id);
    assert.equal(record.grouping_review, row.group_state);
    assert.equal(record.publication_eligibility, row.publication_eligibility);
    assert.equal(record.candidate_record_state, row.candidate_state);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: false, application_name: 'carup-owner-original-104-proof' });
  await client.connect();
  try {
    const version = Number((await client.query('SHOW server_version_num')).rows[0].server_version_num);
    assert.ok(version >= 170000 && version < 180000, 'native PostgreSQL 17 required, observed ' + version);
    const target = (await client.query("SELECT current_database() AS db, inet_server_addr()::text AS addr")).rows[0];
    assert.equal(target.db, ORIGINAL_OWNER_DISPOSABLE_DATABASE);
    assert.ok(['127.0.0.1/32', '::1/128'].includes(target.addr), 'server must be loopback, observed ' + target.addr);
    await assertEmptyOriginalImportTarget(client);
    const priorSeeds = (await client.query('SELECT count(*)::int AS n FROM dealer_research_seed_records')).rows[0].n;
    assert.equal(priorSeeds, 0, 'the dedicated target must hold no prior research seed');

    const first = await commitCandidatesLocal(client, records);
    assert.deepEqual(first, { inserted: 104, identical: 0, read_back: 104, public_profiles_created: 0 });

    const readback = (await client.query(`SELECT seed_dealer_id, source_workbook_sha256, original_source_row,
        source_row_sha256, source_snapshot, proposed_source_category, grouping_review, publication_eligibility,
        claim_lifecycle, logo_rights_status, public_profile_state, candidate_record_state
      FROM dealer_research_seed_records ORDER BY original_source_row`)).rows;
    assert.equal(readback.length, 104);
    let fieldsCompared = 0;
    for (const [i, row] of readback.entries()) {
      const record = records[i];
      for (const key of ['seed_dealer_id', 'source_workbook_sha256', 'original_source_row', 'source_row_sha256',
        'proposed_source_category', 'grouping_review', 'publication_eligibility', 'claim_lifecycle',
        'logo_rights_status', 'public_profile_state', 'candidate_record_state']) {
        assert.equal(row[key], record[key], key + ' readback ' + record.seed_dealer_id);
        fieldsCompared += 1;
      }
      assert.deepEqual(Object.keys(row.source_snapshot).sort(), [...ORIGINAL_HEADERS].sort());
      for (const header of ORIGINAL_HEADERS) {
        // Value-free failure: an assertion diff here would print a restricted research fact.
        if (row.source_snapshot[header] !== record.source_snapshot[header]) {
          fail('stored snapshot differs from source for ' + header + ' of ' + record.seed_dealer_id);
        }
        fieldsCompared += 1;
      }
      // The stored row hash must be recomputable from the stored snapshot (tamper evidence).
      const recomputed = createHash('sha256').update(JSON.stringify(
        Object.fromEntries(ORIGINAL_HEADERS.map((h) => [h, row.source_snapshot[h]])))).digest('hex');
      assert.equal(recomputed, row.source_row_sha256, 'row hash recompute ' + record.seed_dealer_id);
    }
    assert.equal(readback[0].seed_dealer_id, 'ZW-DEAL-0001');
    assert.equal(readback.at(-1).seed_dealer_id, 'ZW-DEAL-0104');
    assert.equal(new Set(readback.map((r) => r.seed_dealer_id)).size, 104);

    const dbCategories = Object.fromEntries((await client.query(`SELECT proposed_source_category AS k, count(*)::int AS n
      FROM dealer_research_seed_records GROUP BY 1 ORDER BY 1`)).rows.map((r) => [r.k, r.n]));
    assert.deepEqual(dbCategories, Object.fromEntries(Object.entries(summary.category_counts).sort(([a], [b]) => a.localeCompare(b))));
    const dbCities = Object.fromEntries((await client.query(`SELECT source_snapshot->>'City / Town' AS k, count(*)::int AS n
      FROM dealer_research_seed_records GROUP BY 1 ORDER BY 2 DESC, 1`)).rows.map((r) => [r.k, r.n]));
    assert.deepEqual(Object.keys(dbCities).sort(), Object.keys(summary.cities).sort());
    const groupingFromDb = analyzeResearchIdentitySignals(readback);
    assert.equal(groupingFromDb.auto_merged_legal_entities, 0);
    assert.equal(groupingFromDb.automatic_publication_decisions, 0);
    assert.equal(groupingFromDb.potential_duplicate_pairs, summary.identity_review_signals.potential_duplicate_pairs);

    const second = await commitCandidatesLocal(client, records);
    assert.deepEqual(second, { inserted: 0, identical: 104, read_back: 104, public_profiles_created: 0 });
    const altered = [{ ...records[0], source_row_sha256: 'f'.repeat(64) }, ...records.slice(1)];
    await assert.rejects(commitCandidatesLocal(client, altered), /immutable source conflict/);
    const afterConflict = (await client.query(`SELECT count(*)::int AS n,
        count(*) FILTER (WHERE public_profile_state = 'NOT_PUBLISHED')::int AS unpublished,
        count(*) FILTER (WHERE claim_lifecycle = 'UNCLAIMED_NO_APPROVED_CLAIM')::int AS unclaimed,
        count(*) FILTER (WHERE publication_eligibility = 'PENDING_HUMAN_SOURCE_ELIGIBILITY')::int AS pending
      FROM dealer_research_seed_records`)).rows[0];
    assert.deepEqual(afterConflict, { n: 104, unpublished: 104, unclaimed: 104, pending: 104 });
    assert.equal(aggregateDigest(readback), aggregateDigest((await client.query(
      'SELECT seed_dealer_id, source_row_sha256 FROM dealer_research_seed_records')).rows));

    const authority = (await client.query(`SELECT
        (SELECT count(*)::int FROM dealer_research_public_profiles) AS public_profiles,
        (SELECT count(*)::int FROM dealer_research_claim_requests) AS claims,
        (SELECT count(*)::int FROM dealer_profiles) AS legal_profiles,
        (SELECT count(*)::int FROM tenants) AS tenants,
        (SELECT count(*)::int FROM organizations) AS organizations,
        (SELECT count(*)::int FROM tenant_users) AS tenant_memberships,
        (SELECT count(*)::int FROM vehicles) AS vehicles`)).rows[0];
    assert.deepEqual(authority, { public_profiles: 0, claims: 0, legal_profiles: 0, tenants: 0,
      organizations: 0, tenant_memberships: 0, vehicles: 0 });

    const evidence = {
      result: 'PASS',
      source_status: 'OWNER_ORIGINAL_REAL_RESEARCH_OBSERVATIONS_NOT_VERIFIED_NOT_PUBLISHED',
      workbook_sha256: hash,
      workbook_bytes: bytes.length,
      worksheets: workbook.worksheets.length,
      source_range: summary.source_range,
      seed_catalogue_range: summary.seed_catalogue_range,
      postgres_server_version_num: version,
      database: target.db,
      server_address: target.addr,
      first_import: first,
      readback_rows: readback.length,
      readback_fields_compared: fieldsCompared,
      row_hashes_recomputed_from_stored_snapshot: readback.length,
      safe_manifest_rows_matched: manifest.rows.length,
      seed_id_first: readback[0].seed_dealer_id,
      seed_id_last: readback.at(-1).seed_dealer_id,
      category_counts_from_db: dbCategories,
      city_counts_from_db: dbCities,
      identity_review_signals_from_db: {
        potential_duplicate_pairs: groupingFromDb.potential_duplicate_pairs,
        repeated_parent_branch_hint_groups: groupingFromDb.repeated_parent_branch_hint_groups,
        largest_unverified_hint_group: groupingFromDb.largest_unverified_hint_group,
        auto_merged_legal_entities: groupingFromDb.auto_merged_legal_entities,
        automatic_publication_decisions: groupingFromDb.automatic_publication_decisions,
        requires_independent_review: groupingFromDb.requires_independent_review,
      },
      idempotent_reimport: second,
      altered_row_reimport: 'REJECTED_IMMUTABLE_SOURCE_CONFLICT_ROLLED_BACK',
      after_conflict_state: afterConflict,
      aggregate_row_digest_sha256: aggregateDigest(readback),
      authority_after_import: authority,
      verified_legal_companies: 0,
      publication_approved: 0,
      contacts_publicly_authorized: false,
    };
    const text = JSON.stringify(evidence, null, 2);
    const publicSafeTokens = new Set([...manifest.rows.map((r) => r.city), ...manifest.rows.map((r) => r.category)]);
    const checked = assertNoRestrictedValues(text, records, publicSafeTokens);
    console.log(text);
    console.log('DEALER_ORIGINAL_104_PRIVACY_SELF_CHECK PASS: ' + checked + ' restricted source values absent from this evidence');
    console.log('DEALER_ORIGINAL_104_NATIVE_RESULT PASS: Owner-original SHA ' + hash.slice(0, 12) + '… · PostgreSQL ' + version +
      ' loopback · 104/104 inserted and field-by-field read back · manifest 104/104 · reimport 104 identical · conflict rolled back · 0 public/legal/tenant/org/claim');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(String(error?.message || error)); process.exitCode = 1; });
}
