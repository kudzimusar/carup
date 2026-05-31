import { EventEmitter } from 'events';
import { supabase } from '../../db/supabase.js';

// In-Memory Event Broker for real-time updates and push notifications
export const memoryBroker = new EventEmitter();

// Max listeners limit increase for large systems
memoryBroker.setMaxListeners(100);

/**
 * Emit a resilient Domain Event via Transactional Outbox Pattern
 * 
 * In a production transaction context, pass the raw PG client to execute atomically.
 * If no client is passed, falls back to the secure Supabase Service Role client.
 * 
 * @param {object|null} pgClient - Optional raw pg client if running inside a database transaction
 * @param {string} eventType - The domain event name (e.g. 'VEHICLE_RESERVED')
 * @param {object} payload - JSON payload of the event
 * @param {string|null} tenantId - Associated tenant context
 * @returns {Promise<object>} The created domain event record
 */
export async function emitDomainEvent(pgClient, eventType, payload, tenantId = null) {
  const eventRecord = {
    event_type: eventType,
    payload: payload,
    status: 'pending',
    attempts: 0,
    tenant_id: tenantId ? String(tenantId) : null,
  };

  if (pgClient && typeof pgClient.query === 'function') {
    // True ACID Transactional Outbox write via direct SQL
    const query = `
      INSERT INTO domain_events (event_type, payload, status, attempts, tenant_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const res = await pgClient.query(query, [
      eventRecord.event_type,
      JSON.stringify(eventRecord.payload),
      eventRecord.status,
      eventRecord.attempts,
      eventRecord.tenant_id
    ]);
    const insertedEvent = res.rows[0];
    
    // Also trigger memory broker immediately after transaction succeeds
    process.nextTick(() => {
      memoryBroker.emit(eventType, insertedEvent);
      memoryBroker.emit('*', { eventType, ...insertedEvent });
    });

    return insertedEvent;
  } else {
    // Fallback standard REST insertion via Supabase Client
    const { data, error } = await supabase
      .from('domain_events')
      .insert([eventRecord])
      .select()
      .single();

    if (error) {
      console.error(`❌ Failed to write outbox event ${eventType}:`, error.message);
      throw new Error(`Outbox persistence error: ${error.message}`);
    }

    // Trigger local listeners
    process.nextTick(() => {
      memoryBroker.emit(eventType, data);
      memoryBroker.emit('*', { eventType, ...data });
    });

    return data;
  }
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
