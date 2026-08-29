import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
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

// Deterministic content comparison that does not depend on key order.
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

/**
 * Decide whether a terminal-instant conflict is this exact write landing twice.
 *
 * The identity is deliberately NOT the event hash. A retry re-reads the VIN tail, which
 * by then contains the terminal row, so it computes a different previous_hash and
 * therefore a different current_hash than the row it is retrying — a hash-equality rule
 * would refuse a legitimate lost-response retry.
 *
 * The stable identity is the logical write itself: signer, VIN, event type and
 * canonically compared payload. That is sound only at the terminal instant, because no
 * representable later event exists there, so a stakeholder can have exactly one such
 * event and any divergence in the logical content is necessarily a different write.
 */
async function findIdempotentTerminalEvent({ vin, eventType, payload, signerId, timestamp }) {
  if (timestamp !== TERMINAL_EVENT_TIMESTAMP) return null;

  const { data, error } = await supabase
    .from('blockchain_events')
    .select(EVENT_SELECT)
    .eq('timestamp', TERMINAL_EVENT_TIMESTAMP)
    .eq('vin', vin);
  if (error) return null;

  const wanted = canonicalize(payload);
  return (data || []).find((row) => {
    const separator = String(row.signature || '').indexOf(':');
    if (separator < 0 || String(row.signature).slice(0, separator) !== String(signerId)) return false;
    if (row.event_type !== eventType) return false;
    const stored = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return canonicalize(stored) === wanted;
  }) || null;
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

// Re-calculate event block hash
export function calculateHash(previousHash, vin, eventType, timestamp, payload) {
  const data = previousHash + vin + eventType + timestamp + JSON.stringify(payload);
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function addEvent(vin, eventType, payload, signature = 'SYSTEM_SIGNATURE') {
  const { data: lastEvents } = await supabase
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
  if (payload.mechanicId) signerId = payload.mechanicId;
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
  const currentHash = calculateHash(previousHash, vin, eventType, timestamp, payload);

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

  const { data: insertedRows, error: insertError } = await supabase
    .from('blockchain_events')
    .insert({
      previous_hash: previousHash,
      current_hash: currentHash,
      vin,
      event_type: eventType,
      payload: JSON.stringify(payload),
      timestamp,
      signature: dynamicSignature,
    })
    .select('id');

  let newEventId = insertedRows?.[0]?.id;

  if (insertError) {
    // The terminal instant is the only timestamp the custody contract can re-issue, and
    // the ledger admits at most one terminal event per signer. A conflict there is
    // either this exact logical write landing twice — a retry whose first response was
    // lost — or a genuinely different write competing for the same instant. Only the
    // former is idempotent.
    const duplicate = isLedgerUniquenessConflict(insertError)
      ? await findIdempotentTerminalEvent({ vin, eventType, payload, signerId, timestamp })
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
      idempotent: true,
    };
  }

  const { count: eventCount } = await supabase
    .from('blockchain_events')
    .select('id', { count: 'exact', head: true })
    .eq('vin', vin);

  if (eventCount && eventCount % 10 === 0) {
    await supabase.from('rolling_integrity_checkpoints').upsert({
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
    payload,
    timestamp,
    signature: dynamicSignature,
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

export async function verifyChain(vin) {
  const { data: checkpoint } = await supabase
    .from('rolling_integrity_checkpoints')
    .select('vin,last_verified_event_id,rolling_hash,verified_at')
    .eq('vin', vin)
    .single();

  let startEventId = 0;
  let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  const checkedChain = [];

  if (checkpoint) {
    const { data: checkpointEvent } = await supabase
      .from('blockchain_events')
      .select(EVENT_SELECT)
      .eq('id', checkpoint.last_verified_event_id)
      .single();

    if (checkpointEvent && checkpointEvent.current_hash === checkpoint.rolling_hash) {
      startEventId = checkpoint.last_verified_event_id;
      expectedPrevHash = checkpoint.rolling_hash;
      checkedChain.push({
        id: checkpointEvent.id,
        eventType: checkpointEvent.event_type,
        timestamp: checkpointEvent.timestamp,
        payload: typeof checkpointEvent.payload === 'string'
          ? JSON.parse(checkpointEvent.payload)
          : checkpointEvent.payload,
        currentHash: checkpointEvent.current_hash,
        signature: checkpointEvent.signature,
      });
    }
  }

  const { data: events, error: eventsError } = await supabase
    .from('blockchain_events')
    .select(EVENT_SELECT)
    .eq('vin', vin)
    .gt('id', startEventId)
    .order('id', { ascending: true });

  if (eventsError) throw new Error(`ledger event lookup failed: ${eventsError.message}`);

  if ((events?.length === 0 || !events) && checkedChain.length === 0) {
    return { verified: true, count: 0, chain: [] };
  }

  for (const e of (events || [])) {
    const payloadParsed = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;

    if (e.previous_hash !== expectedPrevHash) {
      return {
        verified: false,
        tamperIndex: checkedChain.length,
        reason: `Hash link discrepancy. Event ${e.id} expected '${expectedPrevHash}', got '${e.previous_hash}'.`,
        chain: checkedChain,
      };
    }

    const computedHash = calculateHash(e.previous_hash, e.vin, e.event_type, e.timestamp, payloadParsed);
    if (computedHash !== e.current_hash) {
      return {
        verified: false,
        tamperIndex: checkedChain.length,
        reason: `Corrupted block data. Event ${e.id} computed hash mismatch.`,
        chain: checkedChain,
      };
    }

    let signatureNote = null;
    if (e.signature && e.signature !== 'SYSTEM_SIGNATURE' && e.signature.includes(':')) {
      const separator = e.signature.indexOf(':');
      const signerId = e.signature.slice(0, separator);
      const hexSig = e.signature.slice(separator + 1);

      if (signerId === 'system') {
        if (!verifySystemLedgerHash(e.current_hash, hexSig)) {
          return {
            verified: false,
            tamperIndex: checkedChain.length,
            reason: `System HMAC signature mismatch. Event ${e.id} failed.`,
            chain: checkedChain,
          };
        }
      } else {
        const keys = await publicKeysForSigner(signerId);
        const keyRecord = eventKeyForTimestamp(keys, e.timestamp);

        if (keyRecord) {
          const signatureValid = verifyLedgerHash(keyRecord.public_key_pem, e.current_hash, hexSig);
          if (!signatureValid) {
            return {
              verified: false,
              tamperIndex: checkedChain.length,
              reason: `Invalid signature. Event ${e.id} failed verification for actor '${signerId}'.`,
              chain: checkedChain,
            };
          }
        } else if (keys.length > 0) {
          signatureNote = 'PUBLIC_KEY_RECORD_POSTDATES_OR_EXCLUDES_EVENT';
        } else {
          signatureNote = 'PUBLIC_KEY_HISTORY_UNAVAILABLE';
        }
      }
    }

    expectedPrevHash = e.current_hash;
    checkedChain.push({
      id: e.id,
      eventType: e.event_type,
      timestamp: e.timestamp,
      payload: payloadParsed,
      currentHash: e.current_hash,
      signature: e.signature,
      ...(signatureNote ? { note: signatureNote } : {}),
    });
  }

  return { verified: true, count: checkedChain.length, chain: checkedChain };
}
