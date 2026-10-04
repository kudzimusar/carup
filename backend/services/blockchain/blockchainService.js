/**
 * CarUp's hash-chained AUDIT LEDGER (`blockchain_events` — the table keeps its historical name).
 *
 * It is not a blockchain: there is no external party, consensus or replication, and the database
 * owner can still rewrite rows. What it provides is TAMPER EVIDENCE: every event links to the hash of
 * the one before it, events carry a system HMAC or a custodial stakeholder signature, and
 * verifyChain recomputes the chain from genesis and checks each signature (OC-3D). Append-only
 * enforcement at the database is a prepared migration candidate, not yet applied.
 */
import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import {
  canonicalDigest,
  canonicalSerialize,
  hashVersionOf,
  LEDGER_HASH_VERSION_CANONICAL,
  LEDGER_HASH_VERSION_LEGACY,
  V2_HASH_PREFIX,
} from './ledgerCanonicalSerialization.js';
import {
  deriveStakeholderKey,
  signLedgerHash,
  verifyLedgerHash,
  signSystemLedgerHash,
  verifySystemLedgerHash,
} from './blockchainKeyCustodyService.js';

const BASE_PUBLIC_KEY_SELECT =
  'id,user_id,public_key_pem,key_type,status,created_at,revoked_at';
const CUSTODY_PUBLIC_KEY_SELECT =
  `${BASE_PUBLIC_KEY_SELECT},key_ref,key_version,custody_provider`;

export function isMissingCustodyMetadataColumn(error) {
  if (!error) return false;
  const message = String(error.message || error.details || error.hint || '').toLowerCase();
  const code = String(error.code || '').toUpperCase();
  return code === '42703'
    || code === 'PGRST204'
    || (
      /column|schema cache/.test(message)
      && /key_ref|key_version|custody_provider/.test(message)
      && /does not exist|not found|could not find/.test(message)
    );
}

async function selectActivePublicKey(userId) {
  const enhanced = await supabase
    .from('public_keys')
    .select(CUSTODY_PUBLIC_KEY_SELECT)
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (!enhanced.error) {
    return { data: enhanced.data, error: null, custodyMetadataAvailable: true };
  }
  if (!isMissingCustodyMetadataColumn(enhanced.error)) {
    return { data: null, error: enhanced.error, custodyMetadataAvailable: false };
  }

  const legacy = await supabase
    .from('public_keys')
    .select(BASE_PUBLIC_KEY_SELECT)
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  return {
    data: legacy.data,
    error: legacy.error,
    custodyMetadataAvailable: false,
  };
}
const EVENT_SELECT = 'id,previous_hash,current_hash,vin,event_type,payload,timestamp,signature';

function samePublicKey(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

export function isLedgerUniquenessConflict(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || error.details || error.hint || '').toLowerCase();
  return code === '23505'
    || /duplicate key value|unique constraint/.test(message)
    || /uq_blockchain_events_terminal_signer/.test(message);
}

// The last instant the ledger timestamp format can represent. It is the only instant at
// which the custody contract may re-issue a boundary, and the database admits at most
// one event there per signer.
const TERMINAL_EVENT_TIMESTAMP = '9999-12-31T23:59:59.999Z';

// JSON persistence is the first normalization boundary. This mirrors the value that is
// handed to storage: Date becomes an ISO string, undefined object properties disappear,
// undefined array slots become null, and unsupported top-level values fail closed.
export function normalizePersistedPayload(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('ledger payload is not JSON-persistable');
  }
  return JSON.parse(serialized);
}

// Deterministic comparison AFTER persistence normalization: the ONE canonical serialization
// (ledgerCanonicalSerialization.js). Object key order is irrelevant; array order remains meaningful.
function canonicalPersistedPayload(value) {
  return canonicalSerialize(value);
}

const MAX_LEDGER_OPERATION_ID_LENGTH = 200;

function operationIdFrom(options) {
  if (typeof options === 'string') return options.trim() || null;
  const candidate = options?.operationId ?? options?.operation_id ?? null;
  if (candidate === undefined || candidate === null) return null;
  // A malformed identity must be LOUD. Silently coercing it to null would degrade a
  // caller that believes it supplied an identity back into "no identity", which at the
  // terminal instant is the difference between a recoverable retry and a permanent
  // refusal — and the caller would never learn why.
  if (typeof candidate !== 'string') {
    throw new Error('ledger operation id must be a string');
  }
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_LEDGER_OPERATION_ID_LENGTH) {
    throw new Error('ledger operation id exceeds the maximum representable length');
  }
  return trimmed;
}

function signerFromSignature(signature, fallbackSignerId) {
  const raw = String(signature || '');
  const separator = raw.indexOf(':');
  return separator > 0 ? raw.slice(0, separator) : String(fallbackSignerId);
}

/**
 * Classify a terminal uniqueness conflict using the durable operation identity.
 *
 * Content equality is only a consistency guard. It is NOT the idempotency identity:
 * two independent business operations may have identical VIN/event/payload content.
 * The caller must reuse the same durable operation id after a lost response.
 */
async function findIdempotentTerminalEvent({
  vin,
  eventType,
  payload,
  signerId,
  timestamp,
  operationId,
}) {
  if (timestamp !== TERMINAL_EVENT_TIMESTAMP) return null;
  if (!operationId) {
    throw new Error('terminal ledger retry classification requires a durable operation id');
  }

  const { data, error } = await supabase
    .from('blockchain_events')
    .select(`${EVENT_SELECT},operation_id`)
    .eq('timestamp', TERMINAL_EVENT_TIMESTAMP);
  if (error) {
    throw new Error(`terminal ledger retry lookup failed: ${error.message}`);
  }

  const signerRow = (data || []).find((row) => {
    const separator = String(row.signature || '').indexOf(':');
    return separator >= 0 && String(row.signature).slice(0, separator) === String(signerId);
  }) || null;

  if (!signerRow) return null;

  if (String(signerRow.operation_id || '') !== String(operationId)) {
    throw new Error(
      'terminal ledger conflict: a distinct durable operation already owns the signer terminal instant',
    );
  }

  const stored = typeof signerRow.payload === 'string'
    ? JSON.parse(signerRow.payload)
    : signerRow.payload;
  const sameContent = signerRow.vin === vin
    && signerRow.event_type === eventType
    && canonicalPersistedPayload(stored) === canonicalPersistedPayload(payload);

  if (!sameContent) {
    throw new Error(
      'terminal ledger operation id reuse refused: persisted VIN/event/payload differs from this attempt',
    );
  }

  return signerRow;
}

export function isMissingCustodyRolloutContractFunction(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || error.details || error.hint || '').toLowerCase();
  return code === '42883'
    || code === 'PGRST202'
    || (
      /function|schema cache/.test(message)
      && /blockchain_custody_rollout_contract/.test(message)
      && /does not exist|not found|could not find/.test(message)
    );
}

async function custodyRolloutContract(custodyMetadataAvailable) {
  if (!custodyMetadataAvailable) {
    return { state: 'LEGACY', authorizedGeneration: null };
  }

  const { data, error } = await supabase.rpc('blockchain_custody_rollout_contract');
  if (error) {
    if (isMissingCustodyRolloutContractFunction(error)) {
      // Never infer FINALIZED from a missing function. Databases that previously ran
      // the monolithic Issue #158 migration require the later rollout-upgrade migration.
      return { state: 'UPGRADE_REQUIRED', authorizedGeneration: null };
    }
    throw new Error(`blockchain custody rollout contract lookup failed: ${error.message}`);
  }

  const value = Array.isArray(data) ? data[0] : data;
  const contract = typeof value === 'string' ? JSON.parse(value) : value;
  const state = String(contract?.state || '').trim().toUpperCase();
  const authorizedGeneration = String(contract?.authorized_generation || '').trim() || null;
  if (!['PREPARED', 'FINALIZED'].includes(state)) {
    throw new Error(`invalid blockchain custody rollout state: ${state || 'empty'}`);
  }
  return { state, authorizedGeneration };
}

async function activateCustodiedPublicKey(userId, derived) {
  const candidateId = 'key_' + crypto.randomUUID();
  // The boundary contract takes NO caller timestamp: the database establishes a
  // per-stakeholder strictly monotonic activation/event boundary under the same
  // lock that serializes key activation, so colliding or skewed host clocks can
  // never produce ambiguous key validity intervals.
  const { data, error } = await supabase.rpc('blockchain_activate_public_key_boundary', {
    p_candidate_id: candidateId,
    p_user_id: String(userId),
    p_public_key_pem: derived.publicKeyPem,
    p_key_type: 'secp256k1',
    p_key_ref: derived.keyRef,
    p_key_version: derived.keyVersion,
    p_custody_provider: derived.custodyProvider,
    p_custody_generation: derived.custodyGeneration,
  });
  if (error) {
    throw new Error(`atomic public key activation failed: ${error.message}`);
  }
  const activated = Array.isArray(data) ? data[0] : data;
  if (!activated || !samePublicKey(activated.public_key_pem, derived.publicKeyPem)) {
    throw new Error('atomic public key activation returned a different cryptographic identity');
  }
  const authoritativeTimestamp = String(activated.event_timestamp || '').trim();
  if (!authoritativeTimestamp) {
    throw new Error('atomic public key activation returned no authoritative event timestamp');
  }
  return {
    publicKeyPem: derived.publicKeyPem,
    keyRef: derived.keyRef,
    keyVersion: derived.keyVersion,
    custodyGeneration: derived.custodyGeneration,
    custodyProvider: derived.custodyProvider,
    custodyMetadataPersisted: true,
    eventTimestamp: authoritativeTimestamp,
  };
}

/**
 * Ensure the database holds the public half of the deterministic stakeholder key.
 *
 * Private material is derived inside blockchainKeyCustodyService and never read from
 * or written to public_keys. This compatibility export intentionally returns public
 * metadata only.
 */
export async function getOrCreateKeypair(userId) {
  const derived = deriveStakeholderKey(userId);

  const {
    data: existingKey,
    error: lookupError,
    custodyMetadataAvailable,
  } = await selectActivePublicKey(userId);

  if (lookupError) {
    throw new Error(`public key lookup failed: ${lookupError.message}`);
  }

  const rollout = await custodyRolloutContract(custodyMetadataAvailable);

  // Mixed old/new fleets must never rotate or create stakeholder keys. PREPARED is
  // an explicit bounded maintenance state; UPGRADE_REQUIRED covers databases that
  // recorded the earlier monolithic migration but have not received the later
  // rollout-authority upgrade. Neither state may be mistaken for FINALIZED.
  if (rollout.state !== 'FINALIZED') {
    throw new Error(
      `blockchain custody cutover is ${rollout.state.toLowerCase()}; stakeholder signing is temporarily unavailable until protected finalization`,
    );
  }
  if (rollout.authorizedGeneration !== derived.custodyGeneration) {
    throw new Error(
      'stakeholder signer custody generation is not authorized; superseded runtime/configuration is blocked',
    );
  }

  // FINALIZED key writes are owned exclusively by the SECURITY DEFINER atomic RPC.
  // Even the same public key goes through the RPC so service_role needs no direct
  // INSERT/UPDATE privilege on public_keys after the finalizer.
  if (existingKey && samePublicKey(existingKey.public_key_pem, derived.publicKeyPem)) {
    return activateCustodiedPublicKey(userId, derived);
  }

  // First registration, rotation and rollback-to-a-prior-version all create or
  // select the correct active incarnation atomically.
  return activateCustodiedPublicKey(userId, derived);
}

// v1 — the historical hash, kept exactly as written and used ONLY for rows written with it. It hashes
// a bare concatenation (field boundaries can shift between vin / event type / timestamp) over
// JavaScript insertion-order JSON. Never reinterpreted (OC-3D 4E).
export function calculateHash(previousHash, vin, eventType, timestamp, payload) {
  const persistedPayload = normalizePersistedPayload(payload);
  const data = previousHash + vin + eventType + timestamp + JSON.stringify(persistedPayload);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * v2 (OC-3D): sha256 over a domain-separated canonical envelope — named fields, canonical key order
 * at every depth — stored with the `v2:` prefix, so its version is part of the hash itself.
 */
export function calculateHashV2(previousHash, vin, eventType, timestamp, payload) {
  return V2_HASH_PREFIX + canonicalDigest('carup.ledger.event.v2', {
    previous_hash: previousHash,
    vin,
    event_type: eventType,
    timestamp,
    payload: normalizePersistedPayload(payload),
  });
}

/**
 * The scheme NEW events are written with. v2 is introduced by an explicit deployment switch
 * (CARUP_LEDGER_HASH_VERSION=2) with the staged ledger migration — not silently by a code release.
 * Verification handles both versions, row by row, whatever this says.
 */
export function ledgerWriteHashVersion(env = process.env) {
  return String(env.CARUP_LEDGER_HASH_VERSION ?? '').trim() === '2' ? LEDGER_HASH_VERSION_CANONICAL : LEDGER_HASH_VERSION_LEGACY;
}

export function computeLedgerHash(version, previousHash, vin, eventType, timestamp, payload) {
  return version === LEDGER_HASH_VERSION_CANONICAL
    ? calculateHashV2(previousHash, vin, eventType, timestamp, payload)
    : calculateHash(previousHash, vin, eventType, timestamp, payload);
}

/**
 * THE write boundary of the ledger (OC-3D 4J). Domain code submits an event REQUEST — vin, event type,
 * payload, and optionally `{ operationId, signerId, client }` — and this function alone produces the
 * envelope: previous_hash, current_hash (versioned), signature. The ledger records decisions; it
 * makes none. `options.client` lets a domain service write through its own (injected) client;
 * `options.signerId` names the signer explicitly instead of inferring it from payload keys.
 */
export async function addEvent(
  vin,
  eventType,
  payload,
  signature = 'SYSTEM_SIGNATURE',
  options = {},
) {
  const db = (options && typeof options === 'object' && options.client) || supabase;
  const { data: lastEvents } = await db
    .from('blockchain_events')
    .select('current_hash,id')
    .eq('vin', vin)
    .order('id', { ascending: false })
    .limit(1);

  const lastEvent = lastEvents?.[0];
  const previousHash = lastEvent
    ? lastEvent.current_hash
    : '0000000000000000000000000000000000000000000000000000000000000000';

  let signerId = 'system';
  if (options && typeof options === 'object' && options.signerId) signerId = String(options.signerId);
  else if (payload.mechanicId) signerId = payload.mechanicId;
  else if (payload.buyerId) signerId = payload.buyerId;
  else if (payload.reportingOwnerId) signerId = payload.reportingOwnerId;
  else if (payload.insurerId) signerId = payload.insurerId;
  else if (payload.bankId) signerId = payload.bankId;

  // A rotated/first stakeholder public key must exist BEFORE the event timestamp is fixed.
  // Verification selects the key whose validity interval contains the event timestamp.
  let registeredSignerKey = null;
  if (signature === 'SYSTEM_SIGNATURE' && signerId !== 'system') {
    registeredSignerKey = await getOrCreateKeypair(signerId);
  }

  // Stakeholder events are timestamped at the successful generation-authorized key
  // activation/check. If authority rotates immediately afterward, this in-flight
  // event remains inside the old key's validity interval instead of being misclassified
  // under the newly active key. Superseded writers are rejected on their next call.
  const timestamp = registeredSignerKey?.eventTimestamp || new Date().toISOString();
  const persistedPayload = normalizePersistedPayload(payload);
  const operationId = operationIdFrom(options);

  // The terminal boundary is retry-only. If the caller cannot name the durable
  // business/request operation that may be retried after a lost response, fail closed
  // instead of guessing from equal content. The already-allocated same-key boundary is
  // deliberately recoverable, so a subsequent correctly identified retry can proceed.
  if (timestamp === TERMINAL_EVENT_TIMESTAMP && !operationId) {
    throw new Error('terminal ledger event requires a durable operation id');
  }

  const currentHash = computeLedgerHash(ledgerWriteHashVersion(), previousHash, vin, eventType, timestamp, persistedPayload);

  let dynamicSignature = signature;
  if (signature === 'SYSTEM_SIGNATURE') {
    if (signerId === 'system') {
      dynamicSignature = `system:${signSystemLedgerHash(currentHash)}`;
    } else {
      const signed = signLedgerHash(signerId, currentHash);
      if (!samePublicKey(registeredSignerKey?.publicKeyPem, signed.publicKeyPem)) {
        throw new Error('derived stakeholder signing key disagrees with registered public key');
      }
      if (registeredSignerKey?.custodyGeneration !== signed.custodyGeneration) {
        throw new Error('derived stakeholder signing generation disagrees with authorized key generation');
      }
      dynamicSignature = `${signerId}:${signed.signatureHex}`;
    }
  }

  const { data: insertedRows, error: insertError } = await db
    .from('blockchain_events')
    .insert({
      previous_hash: previousHash,
      current_hash: currentHash,
      vin,
      event_type: eventType,
      payload: JSON.stringify(persistedPayload),
      timestamp,
      signature: dynamicSignature,
      ...(timestamp === TERMINAL_EVENT_TIMESTAMP ? { operation_id: operationId } : {}),
    })
    .select('id');

  let newEventId = insertedRows?.[0]?.id;

  if (insertError) {
    // The terminal instant is the only timestamp the custody contract can re-issue, and
    // the ledger admits at most one terminal event per signer. A conflict there is
    // either this exact logical write landing twice — a retry whose first response was
    // lost — or a genuinely different write competing for the same instant. Only the
    // former is idempotent.
    const durableSignerId = signerFromSignature(dynamicSignature, signerId);
    const duplicate = isLedgerUniquenessConflict(insertError)
      ? await findIdempotentTerminalEvent({
          vin,
          eventType,
          payload: persistedPayload,
          signerId: durableSignerId,
          timestamp,
          operationId,
        })
      : null;

    if (!duplicate) {
      throw new Error(`ledger event persistence failed: ${insertError.message}`);
    }

    // Report the row that actually exists, not the values this attempt recomputed
    // against an already-advanced tail.
    return {
      id: duplicate.id,
      previousHash: duplicate.previous_hash,
      currentHash: duplicate.current_hash,
      vin: duplicate.vin,
      eventType: duplicate.event_type,
      payload: typeof duplicate.payload === 'string' ? JSON.parse(duplicate.payload) : duplicate.payload,
      timestamp: duplicate.timestamp,
      signature: duplicate.signature,
      operationId: duplicate.operation_id || operationId,
      idempotent: true,
    };
  }

  const { count: eventCount } = await db
    .from('blockchain_events')
    .select('id', { count: 'exact', head: true })
    .eq('vin', vin);

  // A checkpoint is a WITNESS that verification cross-checks, never a trust root it starts from (4C).
  if (eventCount && eventCount % 10 === 0) {
    await db.from('rolling_integrity_checkpoints').upsert({
      vin,
      last_verified_event_id: newEventId,
      rolling_hash: currentHash,
      verified_at: timestamp,
    }, { onConflict: 'vin' });
    console.log(`    📊 Created rolling integrity checkpoint for vehicle ${vin} at Block #${newEventId}`);
  }

  return {
    id: newEventId,
    previousHash,
    currentHash,
    vin,
    eventType,
    payload: persistedPayload,
    timestamp,
    signature: dynamicSignature,
    operationId: timestamp === TERMINAL_EVENT_TIMESTAMP ? operationId : null,
  };
}

function eventKeyForTimestamp(keys, eventTimestamp) {
  const eventTime = Date.parse(eventTimestamp);
  if (!Number.isFinite(eventTime)) return null;

  // Key validity intervals are half-open: [created_at, revoked_at). At an exact
  // rotation boundary the superseded key is excluded and the new incarnation owns
  // the instant, so boundary-hardened histories yield exactly one eligible key per
  // event timestamp without relying on array order. An ACTIVE (unrevoked) key
  // remains open-ended.
  const eligible = (keys || [])
    .filter((key) => {
      const created = Date.parse(key.created_at || 0);
      const revoked = key.revoked_at ? Date.parse(key.revoked_at) : Number.POSITIVE_INFINITY;
      return Number.isFinite(created) && created <= eventTime && eventTime < revoked;
    })
    .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));

  return eligible[0] || null;
}

async function publicKeysForSigner(signerId) {
  const enhanced = await supabase
    .from('public_keys')
    .select(CUSTODY_PUBLIC_KEY_SELECT)
    .eq('user_id', signerId)
    .order('created_at', { ascending: true });

  if (!enhanced.error) return enhanced.data || [];
  if (!isMissingCustodyMetadataColumn(enhanced.error)) {
    throw new Error(`public key history lookup failed: ${enhanced.error.message}`);
  }

  // Deploy-before-migrate compatibility: historical verification requires only public
  // material and timestamps. The legacy query deliberately names only safe public columns.
  const legacy = await supabase
    .from('public_keys')
    .select(BASE_PUBLIC_KEY_SELECT)
    .eq('user_id', signerId)
    .order('created_at', { ascending: true });
  if (legacy.error) throw new Error(`public key history lookup failed: ${legacy.error.message}`);
  return legacy.data || [];
}

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * What an event's `signature` field actually proves (OC-3D 4H):
 *   verified          — a system HMAC (server secret) or a custodial stakeholder ECDSA signature that
 *                       checked out against the event hash;
 *   absent            — no signature;
 *   legacy_unverified — a placeholder ('SYSTEM_SIGNATURE'), a token without signer:proof form, or a
 *                       stakeholder signature whose public-key history cannot be found: NOT a signature;
 *   invalid           — a signature that was checked and is wrong.
 * Custodial stakeholder keys are derived server-side, so a stakeholder signature proves the CarUp
 * server signed for that stakeholder — not that the stakeholder did.
 */
export const SIGNATURE_STATUS = Object.freeze({
  VERIFIED: 'verified',
  ABSENT: 'absent',
  LEGACY_UNVERIFIED: 'legacy_unverified',
  INVALID: 'invalid',
});

async function signatureStatusOf(event) {
  const raw = event.signature;
  if (raw === null || raw === undefined || String(raw).trim() === '') return { status: SIGNATURE_STATUS.ABSENT };
  const signature = String(raw);
  const separator = signature.indexOf(':');
  if (signature === 'SYSTEM_SIGNATURE' || separator <= 0) {
    return { status: SIGNATURE_STATUS.LEGACY_UNVERIFIED, kind: 'placeholder' };
  }
  const signerId = signature.slice(0, separator);
  const proof = signature.slice(separator + 1);
  if (signerId === 'system') {
    return verifySystemLedgerHash(event.current_hash, proof)
      ? { status: SIGNATURE_STATUS.VERIFIED, kind: 'system_hmac' }
      : { status: SIGNATURE_STATUS.INVALID, kind: 'system_hmac', signerId };
  }
  const keys = await publicKeysForSigner(signerId);
  const keyRecord = eventKeyForTimestamp(keys, event.timestamp);
  if (keyRecord) {
    return verifyLedgerHash(keyRecord.public_key_pem, event.current_hash, proof)
      ? { status: SIGNATURE_STATUS.VERIFIED, kind: 'stakeholder_ecdsa' }
      : { status: SIGNATURE_STATUS.INVALID, kind: 'stakeholder_ecdsa', signerId };
  }
  return {
    status: SIGNATURE_STATUS.LEGACY_UNVERIFIED,
    kind: 'stakeholder_ecdsa',
    note: keys.length > 0 ? 'PUBLIC_KEY_RECORD_POSTDATES_OR_EXCLUDES_EVENT' : 'PUBLIC_KEY_HISTORY_UNAVAILABLE',
  };
}

/**
 * Verify a VIN's hash-chained audit ledger FROM GENESIS (OC-3D).
 *
 * The rolling checkpoint used to be a trust root: if the checkpoint row agreed with the event it
 * named, every earlier event was skipped — so history before it could be rewritten, and an attacker
 * who could write events could also write the (unauthenticated) checkpoint. Now the checkpoint is a
 * WITNESS: the chain is recomputed from genesis every time, and a checkpoint that names an event
 * missing from the recomputed chain, or a hash that disagrees with it, is itself evidence of
 * tampering. Each event is recomputed with the hash scheme it was written with (v1 or v2) and its
 * signature classified; an invalid signature, or a v2 event without a verified one, breaks the chain.
 * v1 history with no verifiable signature stays readable but is reported as not authenticated.
 */
export async function verifyChain(vin) {
  const { data: events, error: eventsError } = await supabase
    .from('blockchain_events')
    .select(EVENT_SELECT)
    .eq('vin', vin)
    .order('id', { ascending: true });

  if (eventsError) throw new Error(`ledger event lookup failed: ${eventsError.message}`);

  const { data: checkpoint } = await supabase
    .from('rolling_integrity_checkpoints')
    .select('vin,last_verified_event_id,rolling_hash,verified_at')
    .eq('vin', vin)
    .single();

  const signatures = { verified: 0, absent: 0, legacy_unverified: 0, invalid: 0 };
  const hashVersions = { v1: 0, v2: 0 };
  const checkedChain = [];
  const failure = (reason, tamperIndex = checkedChain.length) => ({
    verified: false,
    tamperIndex,
    reason,
    chain: checkedChain,
    signatures,
    hash_versions: hashVersions,
  });

  let expectedPrevHash = GENESIS_HASH;
  for (const e of (events || [])) {
    const payloadParsed = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;

    if (e.previous_hash !== expectedPrevHash) {
      return failure(`Hash link discrepancy. Event ${e.id} expected '${expectedPrevHash}', got '${e.previous_hash}'.`);
    }

    const version = hashVersionOf(e.current_hash);
    const computedHash = computeLedgerHash(version, e.previous_hash, e.vin, e.event_type, e.timestamp, payloadParsed);
    if (computedHash !== e.current_hash) {
      return failure(`Corrupted block data. Event ${e.id} computed hash mismatch.`);
    }

    const signature = await signatureStatusOf(e);
    if (signature.status === SIGNATURE_STATUS.INVALID) {
      return failure(signature.kind === 'system_hmac'
        ? `System HMAC signature mismatch. Event ${e.id} failed.`
        : `Invalid signature. Event ${e.id} failed verification for actor '${signature.signerId}'.`);
    }
    if (version === LEDGER_HASH_VERSION_CANONICAL && signature.status !== SIGNATURE_STATUS.VERIFIED) {
      return failure(`Unauthenticated v2 event. Event ${e.id} carries no verifiable signature.`);
    }

    signatures[signature.status] += 1;
    hashVersions[version === LEDGER_HASH_VERSION_CANONICAL ? 'v2' : 'v1'] += 1;
    expectedPrevHash = e.current_hash;
    checkedChain.push({
      id: e.id,
      eventType: e.event_type,
      timestamp: e.timestamp,
      payload: payloadParsed,
      currentHash: e.current_hash,
      signature: e.signature,
      signature_status: signature.status,
      hash_version: version,
      ...(signature.note ? { note: signature.note } : {}),
    });
  }

  // The checkpoint witness (never a starting point).
  let checkpointStatus = 'absent';
  if (checkpoint && checkpoint.last_verified_event_id !== null && checkpoint.last_verified_event_id !== undefined) {
    const index = checkedChain.findIndex((event) => String(event.id) === String(checkpoint.last_verified_event_id));
    if (index < 0) {
      return failure(`Checkpoint witness references event ${checkpoint.last_verified_event_id}, which is not in the verified chain.`);
    }
    if (checkedChain[index].currentHash !== checkpoint.rolling_hash) {
      return failure(`Checkpoint witness disagrees with recomputed history at event ${checkpoint.last_verified_event_id}.`, index);
    }
    checkpointStatus = 'consistent';
  }

  return {
    verified: true,
    count: checkedChain.length,
    chain: checkedChain,
    signatures,
    authenticated: checkedChain.length > 0 && signatures.verified === checkedChain.length,
    hash_versions: hashVersions,
    checkpoint: checkpointStatus,
  };
}
