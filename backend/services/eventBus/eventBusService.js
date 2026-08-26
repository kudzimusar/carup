import { EventEmitter } from 'events';
import { supabase } from '../../db/supabase.js';

// In-Memory Event Broker for real-time updates and push notifications
export const memoryBroker = new EventEmitter();

// Max listeners limit increase for large systems
memoryBroker.setMaxListeners(100);

/**
 * Event types whose payload carries a DETERMINISTIC identity, and the payload field that is it.
 *
 * This registry is deliberately a closed list rather than a heuristic. Recovering from a unique
 * violation means answering "which existing row is the one I just failed to insert?", and that is
 * only answerable when the identity is (a) derived from the payload the caller supplied and (b) the
 * same value the database derived its dedupe_key from. Anything outside this list keeps the old
 * behaviour exactly: a 23505 is a real error and is thrown.
 *
 * The key format MUST match `communication_domain_event_dedupe_key()` in
 * database/migrations/20260826120000_email_1_0_hardening.sql. A test pins the two together, because
 * a silent divergence would turn idempotent recovery into an unrecoverable insert failure.
 */
const DETERMINISTIC_EVENT_IDENTITY_FIELDS = Object.freeze({
  'marketplace.inquiry.created': ['inquiryId', 'inquiry_id'],
  'vehicle.trust.presentation_changed': ['presentation_fingerprint'],
});

/**
 * The deterministic identity of an event, or null when the type has none.
 *
 * Returns the dedupe key in the database's own format so recovery can look the row up by the exact
 * value the unique index rejected, rather than by re-deriving a second notion of sameness.
 */
export function deterministicEventIdentity(eventType, payload = {}) {
  const fields = DETERMINISTIC_EVENT_IDENTITY_FIELDS[eventType];
  if (!fields) return null;
  for (const field of fields) {
    const raw = payload?.[field];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (value) return { eventType, field, value, dedupeKey: `${eventType}:${value}` };
  }
  return null;
}

/** Is this error the unique-violation the deterministic dedupe index raises? */
function isDedupeUniqueViolation(error) {
  return error?.code === '23505'
    || /duplicate key|idx_domain_events_dedupe_key/i.test(error?.message || '');
}

function emitMemory(eventType, record) {
  process.nextTick(() => {
    memoryBroker.emit(eventType, record);
    memoryBroker.emit('*', { eventType, ...record });
  });
}

async function existingMarketplaceInquiryEventFromSupabase(eventType, inquiryId) {
  if (!inquiryId) return null;
  const { data, error } = await supabase
    .from('domain_events')
    .select('*')
    .eq('event_type', eventType)
    .contains('payload', { inquiryId })
    .maybeSingle();
  if (error) throw new Error(`Outbox idempotency lookup error: ${error.message}`);
  return data || null;
}

/**
 * Recover the canonical row a deterministic-identity insert collided with.
 *
 * Marketplace keeps its original payload-contains lookup untouched: historical inquiry events
 * predate the dedupe column and carry a NULL dedupe_key, so a key lookup would miss the very row
 * that is canonical. Types added with the key from the start are looked up BY the key, which is the
 * exact value the unique index rejected.
 */
async function existingDeterministicEventFromSupabase(identity) {
  if (!identity) return null;
  if (identity.eventType === 'marketplace.inquiry.created') {
    return existingMarketplaceInquiryEventFromSupabase(identity.eventType, identity.value);
  }
  const { data, error } = await supabase
    .from('domain_events')
    .select('*')
    .eq('dedupe_key', identity.dedupeKey)
    .maybeSingle();
  if (error) throw new Error(`Outbox idempotency lookup error: ${error.message}`);
  return data || null;
}

/**
 * Emit a resilient Domain Event via Transactional Outbox Pattern
 *
 * In a production transaction context, pass the raw PG client to execute atomically.
 * If no client is passed, falls back to the secure Supabase Service Role client.
 *
 * Marketplace inquiry events are database-idempotent by inquiryId once the
 * Communications 2.0 reliability migration is applied. This lets the
 * marketplace_inquiries AFTER INSERT trigger create the event in the same DB
 * transaction while this explicit call remains a safe compatibility confirmation.
 *
 * @param {object|null} pgClient - Optional raw pg client if running inside a database transaction
 * @param {string} eventType - The domain event name (e.g. 'VEHICLE_RESERVED')
 * @param {object} payload - JSON payload of the event
 * @param {string|null} tenantId - Associated tenant context
 * @returns {Promise<object>} The created or idempotently recovered domain event record
 */
export async function emitDomainEvent(pgClient, eventType, payload, tenantId = null) {
  const eventRecord = {
    event_type: eventType,
    payload,
    status: 'pending',
    attempts: 0,
    tenant_id: tenantId ? String(tenantId) : null,
  };
  const identity = deterministicEventIdentity(eventType, payload);

  if (pgClient && typeof pgClient.query === 'function') {
    const query = identity
      ? `
        INSERT INTO domain_events (event_type, payload, status, attempts, tenant_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
        RETURNING *;
      `
      : `
        INSERT INTO domain_events (event_type, payload, status, attempts, tenant_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
      `;
    const res = await pgClient.query(query, [
      eventRecord.event_type,
      JSON.stringify(eventRecord.payload),
      eventRecord.status,
      eventRecord.attempts,
      eventRecord.tenant_id,
    ]);
    let insertedEvent = res.rows[0] || null;

    if (!insertedEvent && identity) {
      // ON CONFLICT DO NOTHING returned no row, so an equivalent event already exists. Recover it
      // and return it as this call's durable event: the caller asked for the event to EXIST, and it
      // does. Marketplace keeps its original payload-field lookup for the historical-NULL-key
      // reason above; everything else resolves by the deterministic key.
      const existing = identity.eventType === 'marketplace.inquiry.created'
        ? await pgClient.query(
          `SELECT *
             FROM domain_events
            WHERE event_type = $1
              AND payload ->> 'inquiryId' = $2
            ORDER BY created_at ASC
            LIMIT 1`,
          [eventType, identity.value],
        )
        : await pgClient.query(
          `SELECT *
             FROM domain_events
            WHERE dedupe_key = $1
            ORDER BY created_at ASC
            LIMIT 1`,
          [identity.dedupeKey],
        );
      insertedEvent = existing.rows[0] || null;
    }
    if (!insertedEvent) {
      throw new Error(`Outbox persistence error: ${eventType} insert produced no record`);
    }

    emitMemory(eventType, insertedEvent);
    return insertedEvent;
  }

  const { data, error } = await supabase
    .from('domain_events')
    .insert([eventRecord])
    .select()
    .single();

  if (error) {
    // A unique violation is only recoverable when this event type has a deterministic identity —
    // otherwise there is no way to say WHICH row we collided with, and swallowing the error would
    // silently drop a real event. Everything outside the registry still throws, as it always did.
    const duplicate = Boolean(identity) && isDedupeUniqueViolation(error);
    if (!duplicate) {
      console.error(`❌ Failed to write outbox event ${eventType}:`, error.message);
      throw new Error(`Outbox persistence error: ${error.message}`);
    }

    const existing = await existingDeterministicEventFromSupabase(identity);
    if (!existing) {
      throw new Error(`Outbox persistence error: duplicate ${eventType} could not be recovered`);
    }
    emitMemory(eventType, existing);
    return existing;
  }

  emitMemory(eventType, data);
  return data;
}

/**
 * Publish an instant, non-persistent memory-only event
 *
 * @param {string} eventType
 * @param {object} payload
 */
export function publishMemoryEvent(eventType, payload) {
  memoryBroker.emit(eventType, payload);
  memoryBroker.emit('*', { eventType, ...payload });
}

console.log('✅ Real-Time Domain Event Bus Service loaded.');
