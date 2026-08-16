import { EventEmitter } from 'events';
import { supabase } from '../../db/supabase.js';

// In-Memory Event Broker for real-time updates and push notifications
export const memoryBroker = new EventEmitter();

// Max listeners limit increase for large systems
memoryBroker.setMaxListeners(100);

function marketplaceInquiryId(eventType, payload = {}) {
  if (eventType !== 'marketplace.inquiry.created') return null;
  const value = payload.inquiryId || payload.inquiry_id || null;
  return value == null ? null : String(value);
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
  const inquiryId = marketplaceInquiryId(eventType, payload);

  if (pgClient && typeof pgClient.query === 'function') {
    const query = inquiryId
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

    if (!insertedEvent && inquiryId) {
      const existing = await pgClient.query(
        `SELECT *
           FROM domain_events
          WHERE event_type = $1
            AND payload ->> 'inquiryId' = $2
          ORDER BY created_at ASC
          LIMIT 1`,
        [eventType, inquiryId],
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
    const duplicate = inquiryId && (
      error.code === '23505'
      || /duplicate key|idx_domain_events_dedupe_key/i.test(error.message || '')
    );
    if (!duplicate) {
      console.error(`❌ Failed to write outbox event ${eventType}:`, error.message);
      throw new Error(`Outbox persistence error: ${error.message}`);
    }

    const existing = await existingMarketplaceInquiryEventFromSupabase(eventType, inquiryId);
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
