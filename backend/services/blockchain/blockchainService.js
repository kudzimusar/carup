import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';

// In-memory cache for private keys (loaded from DB on first use per process)
const privateKeyStore = new Map();

// Helper to get or create a stakeholder's secp256k1 keypair
export async function getOrCreateKeypair(userId) {
  if (privateKeyStore.has(userId)) {
    const { data: existingKey } = await supabase
      .from('public_keys')
      .select('public_key_pem')
      .eq('user_id', userId)
      .eq('status', 'ACTIVE')
      .single();
    if (existingKey) {
      return { publicKeyPem: existingKey.public_key_pem, privateKeyPem: privateKeyStore.get(userId) };
    }
  }
  
  const { data: existingKey } = await supabase
    .from('public_keys')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .single();
  
  if (existingKey && existingKey.private_key_pem) {
    privateKeyStore.set(userId, existingKey.private_key_pem);
    return { publicKeyPem: existingKey.public_key_pem, privateKeyPem: existingKey.private_key_pem };
  }
  
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  
  const id = 'key_' + crypto.randomUUID();
  const timestamp = new Date().toISOString();
  
  if (existingKey) {
    await supabase.from('public_keys').update({ status: 'REVOKED', revoked_at: timestamp }).eq('id', existingKey.id);
  }
  
  await supabase.from('public_keys').insert({
    id, user_id: userId, public_key_pem: publicKey, private_key_pem: privateKey, key_type: 'secp256k1', status: 'ACTIVE', created_at: timestamp
  });
  
  privateKeyStore.set(userId, privateKey);
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

// Re-calculate event block hash
export function calculateHash(previousHash, vin, eventType, timestamp, payload) {
  const data = previousHash + vin + eventType + timestamp + JSON.stringify(payload);
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function addEvent(vin, eventType, payload, signature = 'SYSTEM_SIGNATURE') {
  // Fetch last event to link previous_hash
  const { data: lastEvents } = await supabase
    .from('blockchain_events')
    .select('current_hash, id')
    .eq('vin', vin)
    .order('id', { ascending: false })
    .limit(1);
    
  const lastEvent = lastEvents?.[0];
  const previousHash = lastEvent 
    ? lastEvent.current_hash 
    : '0000000000000000000000000000000000000000000000000000000000000000';
    
  const timestamp = new Date().toISOString();
  const currentHash = calculateHash(previousHash, vin, eventType, timestamp, payload);
  
  let signerId = 'system';
  if (payload.mechanicId) signerId = payload.mechanicId;
  else if (payload.buyerId) signerId = payload.buyerId;
  else if (payload.reportingOwnerId) signerId = payload.reportingOwnerId;
  else if (payload.insurerId) signerId = payload.insurerId;
  else if (payload.bankId) signerId = payload.bankId;
  
  let dynamicSignature = signature;
  if (signature === 'SYSTEM_SIGNATURE') {
    if (signerId === 'system') {
      const hmac = crypto.createHmac('sha256', 'carup-system-secret');
      hmac.update(currentHash);
      dynamicSignature = `system:${hmac.digest('hex')}`;
    } else {
      const { privateKeyPem } = await getOrCreateKeypair(signerId);
      const sign = crypto.createSign('SHA256');
      sign.update(currentHash);
      sign.end();
      const hexSig = sign.sign(privateKeyPem, 'hex');
      dynamicSignature = `${signerId}:${hexSig}`;
    }
  }
  
  const { data: insertedRows } = await supabase
    .from('blockchain_events')
    .insert({
      previous_hash: previousHash,
      current_hash: currentHash,
      vin,
      event_type: eventType,
      payload: JSON.stringify(payload),
      timestamp,
      signature: dynamicSignature
    })
    .select('id');
    
  const newEventId = insertedRows?.[0]?.id;

  // Rolling checkpoint every 10 events
  const { count: eventCount } = await supabase
    .from('blockchain_events')
    .select('*', { count: 'exact', head: true })
    .eq('vin', vin);
    
  if (eventCount && eventCount % 10 === 0) {
    await supabase.from('rolling_integrity_checkpoints').upsert({
      vin, last_verified_event_id: newEventId, rolling_hash: currentHash, verified_at: timestamp
    }, { onConflict: 'vin' });
    console.log(`    📊 Created rolling integrity checkpoint for vehicle ${vin} at Block #${newEventId}`);
  }

  return { id: newEventId, previousHash, currentHash, vin, eventType, payload, timestamp, signature: dynamicSignature };
}

export async function verifyChain(vin) {
  // Load last rolling checkpoint to avoid linear scans
  const { data: checkpoint } = await supabase
    .from('rolling_integrity_checkpoints')
    .select('*')
    .eq('vin', vin)
    .single();
  
  let startEventId = 0;
  let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  const checkedChain = [];
  
  if (checkpoint) {
    const { data: checkpointEvent } = await supabase
      .from('blockchain_events')
      .select('*')
      .eq('id', checkpoint.last_verified_event_id)
      .single();
      
    if (checkpointEvent && checkpointEvent.current_hash === checkpoint.rolling_hash) {
      startEventId = checkpoint.last_verified_event_id;
      expectedPrevHash = checkpoint.rolling_hash;
      checkedChain.push({
        id: checkpointEvent.id, eventType: checkpointEvent.event_type, timestamp: checkpointEvent.timestamp,
        payload: JSON.parse(checkpointEvent.payload), currentHash: checkpointEvent.current_hash, signature: checkpointEvent.signature
      });
    }
  }
  
  const { data: events } = await supabase
    .from('blockchain_events')
    .select('*')
    .eq('vin', vin)
    .gt('id', startEventId)
    .order('id', { ascending: true });
  
  if ((events?.length === 0 || !events) && checkedChain.length === 0) {
    return { verified: true, count: 0, chain: [] };
  }
  
  for (const e of (events || [])) {
    const payloadParsed = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
    
    if (e.previous_hash !== expectedPrevHash) {
      return { verified: false, tamperIndex: checkedChain.length, reason: `Hash link discrepancy. Event ${e.id} expected '${expectedPrevHash}', got '${e.previous_hash}'.`, chain: checkedChain };
    }
    
    const computedHash = calculateHash(e.previous_hash, e.vin, e.event_type, e.timestamp, payloadParsed);
    if (computedHash !== e.current_hash) {
      return { verified: false, tamperIndex: checkedChain.length, reason: `Corrupted block data. Event ${e.id} computed hash mismatch.`, chain: checkedChain };
    }
    
    if (e.signature && e.signature !== 'SYSTEM_SIGNATURE' && e.signature.includes(':')) {
      const [signerId, hexSig] = e.signature.split(':');
      
      if (signerId === 'system') {
        const hmac = crypto.createHmac('sha256', 'carup-system-secret');
        hmac.update(e.current_hash);
        const expectedHmac = hmac.digest('hex');
        if (hexSig !== expectedHmac) {
          return { verified: false, tamperIndex: checkedChain.length, reason: `System HMAC signature mismatch. Event ${e.id} failed.`, chain: checkedChain };
        }
      } else {
        const { data: keyRecord } = await supabase
          .from('public_keys')
          .select('public_key_pem, created_at')
          .eq('user_id', signerId)
          .eq('status', 'ACTIVE')
          .single();
          
        if (keyRecord) {
          if (keyRecord.created_at > e.timestamp) {
            checkedChain.push({ id: e.id, eventType: e.event_type, timestamp: e.timestamp, payload: payloadParsed, currentHash: e.current_hash, signature: e.signature, note: 'KEY_ROTATED_AFTER_EVENT' });
            expectedPrevHash = e.current_hash;
            continue;
          }
          
          const verify = crypto.createVerify('SHA256');
          verify.update(e.current_hash);
          verify.end();
          const signatureValid = verify.verify(keyRecord.public_key_pem, hexSig, 'hex');
          
          if (!signatureValid) {
            return { verified: false, tamperIndex: checkedChain.length, reason: `Invalid signature. Event ${e.id} failed verification for actor '${signerId}'.`, chain: checkedChain };
          }
        }
      }
    }
    
    expectedPrevHash = e.current_hash;
    checkedChain.push({ id: e.id, eventType: e.event_type, timestamp: e.timestamp, payload: payloadParsed, currentHash: e.current_hash, signature: e.signature });
  }
  
  return { verified: true, count: checkedChain.length, chain: checkedChain };
}
