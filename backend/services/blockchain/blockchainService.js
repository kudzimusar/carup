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

export function isPublicKeyRegistrationConflict(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || error.details || '').toLowerCase();
  return code === '23505' || /duplicate key|unique constraint/.test(message);
}

function deterministicPublicKeyId(userId, derived) {
  return 'key_' + crypto.createHash('sha256')
    .update(`${String(userId)}|${derived.keyVersion}|${derived.fingerprint}`)
    .digest('hex');
}

async function activateCustodiedPublicKey(userId, derived, timestamp) {
  const candidateId = 'key_' + crypto.randomUUID();
  const { data, error } = await supabase.rpc('blockchain_activate_public_key_atomic', {
    p_candidate_id: candidateId,
    p_user_id: String(userId),
    p_public_key_pem: derived.publicKeyPem,
    p_key_type: 'secp256k1',
    p_created_at: timestamp,
    p_key_ref: derived.keyRef,
    p_key_version: derived.keyVersion,
    p_custody_provider: derived.custodyProvider,
  });
  if (error) {
    throw new Error(`atomic public key activation failed: ${error.message}`);
  }
  const activated = Array.isArray(data) ? data[0] : data;
  if (!activated || !samePublicKey(activated.public_key_pem, derived.publicKeyPem)) {
    throw new Error('atomic public key activation returned a different cryptographic identity');
  }
  return {
    publicKeyPem: derived.publicKeyPem,
    keyRef: derived.keyRef,
    keyVersion: derived.keyVersion,
    custodyProvider: derived.custodyProvider,
    custodyMetadataPersisted: true,
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
  const timestamp = new Date().toISOString();

  const {
    data: existingKey,
    error: lookupError,
    custodyMetadataAvailable,
  } = await selectActivePublicKey(userId);

  if (lookupError) {
    throw new Error(`public key lookup failed: ${lookupError.message}`);
  }

  if (existingKey && samePublicKey(existingKey.public_key_pem, derived.publicKeyPem)) {
    if (
      custodyMetadataAvailable
      && (
        existingKey.key_ref !== derived.keyRef
        || existingKey.key_version !== derived.keyVersion
        || existingKey.custody_provider !== derived.custodyProvider
      )
    ) {
      const { error: metadataError } = await supabase
        .from('public_keys')
        .update({
          key_ref: derived.keyRef,
          key_version: derived.keyVersion,
          custody_provider: derived.custodyProvider,
        })
        .eq('id', existingKey.id);
      if (metadataError) {
        throw new Error(`public key custody metadata update failed: ${metadataError.message}`);
      }
    }
    return {
      publicKeyPem: derived.publicKeyPem,
      keyRef: derived.keyRef,
      keyVersion: derived.keyVersion,
      custodyProvider: derived.custodyProvider,
      custodyMetadataPersisted: custodyMetadataAvailable,
    };
  }

  if (custodyMetadataAvailable) {
    // Post-migration registration/rotation is one database transaction. This is
    // also how a previously used version is reactivated: a fresh row/incarnation
    // is created rather than erasing the historical revoked_at interval.
    return activateCustodiedPublicKey(userId, derived, timestamp);
  }

  if (existingKey) {
    // Deploy-before-migrate compatibility is safe for reading an unchanged active
    // key, but rotation cannot be made atomic without the custody migration RPC.
    throw new Error(
      'blockchain custody migration is required before rotating stakeholder signing keys',
    );
  }

  const row = {
    // Deterministic identity means two instances racing to register the same
    // derived key contend on the same primary key even before the uniqueness
    // migration is applied.
    id: deterministicPublicKeyId(userId, derived),
    user_id: String(userId),
    public_key_pem: derived.publicKeyPem,
    key_type: 'secp256k1',
    status: 'ACTIVE',
    created_at: timestamp,
    ...(custodyMetadataAvailable
      ? {
        key_ref: derived.keyRef,
        key_version: derived.keyVersion,
        custody_provider: derived.custodyProvider,
      }
      : {}),
  };

  const { error: insertError } = await supabase.from('public_keys').insert(row);
  if (insertError) {
    if (isPublicKeyRegistrationConflict(insertError)) {
      // Another process may have won the same first-registration/rotation race.
      // Re-read the ONE active key and accept only the identical derived public key.
      const raced = await selectActivePublicKey(userId);
      if (
        !raced.error
        && raced.data
        && samePublicKey(raced.data.public_key_pem, derived.publicKeyPem)
      ) {
        return {
          publicKeyPem: derived.publicKeyPem,
          keyRef: derived.keyRef,
          keyVersion: derived.keyVersion,
          custodyProvider: derived.custodyProvider,
          custodyMetadataPersisted: raced.custodyMetadataAvailable,
        };
      }
    }
    throw new Error(`public key registration failed: ${insertError.message}`);
  }

  return {
    publicKeyPem: derived.publicKeyPem,
    keyRef: derived.keyRef,
    keyVersion: derived.keyVersion,
    custodyProvider: derived.custodyProvider,
    custodyMetadataPersisted: custodyMetadataAvailable,
  };
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

  const timestamp = new Date().toISOString();
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

  if (insertError) {
    throw new Error(`ledger event persistence failed: ${insertError.message}`);
  }

  const newEventId = insertedRows?.[0]?.id;

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

  const eligible = (keys || [])
    .filter((key) => {
      const created = Date.parse(key.created_at || 0);
      const revoked = key.revoked_at ? Date.parse(key.revoked_at) : Number.POSITIVE_INFINITY;
      return Number.isFinite(created) && created <= eventTime && eventTime <= revoked;
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
