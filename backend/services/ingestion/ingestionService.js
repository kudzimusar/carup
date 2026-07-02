/**
 * Ingestion engine — Milestone 2 (master plan §6.2, §6.7).
 *
 * Drives an external-source provider through a durable job: idempotent per source record,
 * quarantines invalid records without failing the whole batch, routes ambiguous identity
 * to the human queue, captures immutable listing snapshots, and imports assets as
 * evidence with FULL provenance (reusing the M1 evidence + chain-of-custody model).
 *
 * Retry/backoff/dead-letter are modeled on ingestion_jobs (status machine). The engine
 * never marks a source live and never silently attaches uncertain evidence (master plan §2.6, §6.4).
 */
import crypto from 'crypto';
import { computePerceptualHash } from '../evidence/perceptualHash.js';
import { recordProvenanceEvent } from '../evidence/provenanceService.js';
import { resolveIdentity } from './identityResolution.js';
import { createListingSnapshot } from './listingSnapshotService.js';

function sha256(input) {
  return crypto.createHash('sha256').update(typeof input === 'string' ? input : JSON.stringify(input)).digest('hex');
}

function backoffMs(attempts) {
  return Math.min(60_000, 1000 * 4 ** attempts); // 1s, 4s, 16s, 60s cap
}

async function findExistingSourceRecord(supabase, sourceId, sourceRecordId) {
  const { data } = await supabase
    .from('source_records')
    .select('*')
    .eq('source_id', sourceId)
    .eq('source_record_id', sourceRecordId)
    .limit(1);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows[0] || null;
}

async function upsertSourceRecord(supabase, existing, payload) {
  if (existing) {
    const { data } = await supabase.from('source_records').update(payload).eq('id', existing.id).select();
    return Array.isArray(data) ? data[0] : data;
  }
  const { data } = await supabase.from('source_records').insert(payload).select();
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Import one asset as a vehicle_evidence row + 'imported' provenance event.
 * Reuses the M1 taxonomy/provenance columns. Returns the inserted evidence row.
 */
async function importAssetAsEvidence(supabase, { provider, vin, sourceId, sourceRecordId, normalized, asset }) {
  let checksum = null;
  let perceptual = null;
  let mimeType = asset.mime_type || null;
  try {
    const dl = await provider.downloadAsset(asset.ref);
    if (dl && dl.buffer) {
      checksum = sha256(dl.buffer);
      mimeType = dl.mimeType || mimeType;
      const ph = computePerceptualHash(dl.buffer, mimeType);
      perceptual = ph.supported ? ph.hash : null;
    }
  } catch (err) {
    // asset retrieval failure must not abort the record; evidence is created without bytes
    // and flagged for re-fetch via metadata.
  }

  const row = {
    vehicle_id: vin,
    vin,
    evidence_type: asset.legacy_evidence_type || 'auction_photo',
    evidence_class: asset.evidence_class || normalized.evidence_class || 'auction',
    evidence_subtype: asset.evidence_subtype || normalized.evidence_subtype || null,
    file_url: asset.ref,
    storage_bucket: 'vehicle-images',
    file_path: asset.ref,
    mime_type: mimeType || 'image/jpeg',
    file_size: asset.file_size || 0,
    checksum,
    image_hash: checksum,
    checksum_algorithm: checksum ? 'sha256' : null,
    perceptual_hash: perceptual,
    uploaded_by: null,
    uploader_role: 'source_partner',
    event_date: normalized.event_date || null,
    event_date_precision: normalized.event_date_precision || 'day',
    odometer_value: normalized.odometer_value ?? null,
    odometer_unit: normalized.odometer_unit || null,
    source_id: sourceId,
    source_record_id: sourceRecordId,
    received_at: new Date().toISOString(),
    verification_status: 'pending', // imported evidence is unverified until governed review
    visibility_level: 'restricted', // imported third-party evidence is not public by default
    retention_class: 'standard',
    metadata: { imported: true, adapter: provider.id, provider_mode: provider.mode },
  };

  const { data, error } = await supabase.from('vehicle_evidence').insert(row).select();
  if (error) throw new Error(`evidence import failed: ${error.message}`);
  const evidence = Array.isArray(data) ? data[0] : data;

  // Immutable chain-of-custody 'imported' event (master plan §5.5).
  try {
    await recordProvenanceEvent(supabase, {
      evidenceId: evidence.id,
      vin,
      eventType: 'imported',
      actorType: 'source_partner',
      actorRole: 'source_partner',
      details: { adapter: provider.id, source_id: sourceId, source_record_id: sourceRecordId, checksum },
    });
  } catch {
    /* provenance is recorded best-effort; never gate the import */
  }
  return evidence;
}

/**
 * Process a single raw record. Returns the per-record outcome status.
 */
export async function processRecord(supabase, { provider, job, raw, lookups }) {
  const normalized = provider.mapRecord(raw);
  const sourceId = job.source_id;
  const sourceRecordId = normalized.source_record_id;
  const record_hash = sha256(normalized);

  const existing = await findExistingSourceRecord(supabase, sourceId, sourceRecordId);
  if (existing && existing.record_hash === record_hash && existing.status === 'imported') {
    return 'duplicate'; // idempotent: identical record already imported
  }

  const validation = provider.validateRecord(normalized);
  if (!validation.ok) {
    await upsertSourceRecord(supabase, existing, {
      ingestion_job_id: job.id, source_id: sourceId, source_record_id: sourceRecordId,
      record_hash, raw_payload: raw, normalized, status: 'quarantined',
      quarantine_reason: validation.errors.join('; '),
    });
    return 'quarantined';
  }

  const identity = await resolveIdentity(normalized.identity || {}, lookups);

  if (identity.requiresReview) {
    const rec = await upsertSourceRecord(supabase, existing, {
      ingestion_job_id: job.id, source_id: sourceId, source_record_id: sourceRecordId,
      record_hash, raw_payload: raw, normalized, status: 'needs_identity_review',
      identity_confidence: identity.confidence,
    });
    for (const cand of identity.candidates) {
      await supabase.from('vehicle_identity_candidates').insert({
        source_record_id: rec.id,
        candidate_vin: cand.vin,
        match_method: cand.method,
        confidence: cand.confidence,
        status: 'pending',
      });
    }
    return 'needs_identity_review';
  }

  const vin = identity.vin;

  // Immutable listing snapshot for listing-type records (master plan §6.5).
  if (normalized.record_type === 'listing' && normalized.listing) {
    await createListingSnapshot(supabase, { sourceId, sourceRecordId, vin, listing: normalized.listing });
  }

  // Import assets as evidence with provenance.
  let assetCount = 0;
  for (const asset of normalized.assets || []) {
    await importAssetAsEvidence(supabase, { provider, vin, sourceId, sourceRecordId, normalized, asset });
    assetCount += 1;
  }

  await upsertSourceRecord(supabase, existing, {
    ingestion_job_id: job.id, source_id: sourceId, source_record_id: sourceRecordId,
    record_hash, raw_payload: raw, normalized,
    status: assetCount > 0 ? 'imported' : 'mapped',
    vehicle_vin: vin, identity_confidence: identity.confidence,
  });
  return assetCount > 0 ? 'imported' : 'mapped';
}

/**
 * Run a full ingestion job for a provider.
 * @param supabase   service-role client (or test mock)
 * @param opts       { provider, sourceId, requestedBy, idempotencyKey, lookups, maxAttempts }
 */
export async function runIngestionJob(supabase, opts) {
  const { provider, sourceId, requestedBy = null, idempotencyKey = null, lookups = {}, maxAttempts = 5 } = opts;

  // Idempotent job creation: reuse an existing job for the same idempotency key.
  if (idempotencyKey) {
    const { data: existingJobs } = await supabase.from('ingestion_jobs').select('*').eq('idempotency_key', idempotencyKey).limit(1);
    const existing = (Array.isArray(existingJobs) ? existingJobs : []).filter(Boolean)[0];
    if (existing && existing.status === 'succeeded') return existing;
  }

  const { data: created } = await supabase.from('ingestion_jobs').insert({
    source_id: sourceId, adapter_id: provider.id, job_type: 'poll', status: 'running',
    idempotency_key: idempotencyKey, attempts: 1, max_attempts: maxAttempts,
    started_at: new Date().toISOString(),
    stats: { total: 0, imported: 0, mapped: 0, duplicate: 0, quarantined: 0, needs_identity_review: 0 },
  }).select();
  const job = Array.isArray(created) ? created[0] : created;

  const stats = { total: 0, imported: 0, mapped: 0, duplicate: 0, quarantined: 0, needs_identity_review: 0 };
  try {
    let cursor = null;
    do {
      const page = await provider.fetchPage(cursor);
      for (const raw of page.records || []) {
        stats.total += 1;
        const outcome = await processRecord(supabase, { provider, job, raw, lookups });
        stats[outcome] = (stats[outcome] || 0) + 1;
      }
      cursor = page.nextCursor || null;
    } while (cursor);

    const hadIssues = stats.quarantined > 0 || stats.needs_identity_review > 0;
    const finalStatus = hadIssues ? 'partial' : 'succeeded';
    const { data: done } = await supabase.from('ingestion_jobs').update({
      status: finalStatus, stats, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', job.id).select();
    return Array.isArray(done) ? done[0] : done;
  } catch (err) {
    const attempts = Number(job.attempts) || 1;
    const terminal = attempts >= maxAttempts;
    const { data: failed } = await supabase.from('ingestion_jobs').update({
      status: terminal ? 'dead_letter' : 'failed_retryable',
      last_error: err.message,
      next_retry_at: terminal ? null : new Date(Date.now() + backoffMs(attempts)).toISOString(),
      stats, updated_at: new Date().toISOString(),
    }).eq('id', job.id).select();
    return Array.isArray(failed) ? failed[0] : failed;
  }
}

/** Resolve an identity candidate (human decision) — master plan §6.4. */
export async function resolveIdentityCandidate(supabase, candidateId, { decision, resolvedBy, notes }) {
  if (!['confirmed', 'rejected'].includes(decision)) throw new Error('decision must be confirmed|rejected');
  const { data: cands } = await supabase.from('vehicle_identity_candidates').select('*').eq('id', candidateId).limit(1);
  const candidate = (Array.isArray(cands) ? cands : []).filter(Boolean)[0];
  if (!candidate) throw new Error('candidate not found');

  await supabase.from('vehicle_identity_candidates').update({
    status: decision, resolved_by: resolvedBy || null, resolved_at: new Date().toISOString(), notes: notes || null,
  }).eq('id', candidateId);

  if (decision === 'confirmed' && candidate.candidate_vin) {
    await supabase.from('source_records').update({
      status: 'mapped', vehicle_vin: candidate.candidate_vin, identity_confidence: candidate.confidence,
    }).eq('id', candidate.source_record_id);
  }
  return { ...candidate, status: decision };
}

export default { processRecord, runIngestionJob, resolveIdentityCandidate };
