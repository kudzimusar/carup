import pg from 'pg';
import { memoryBroker } from './eventBusService.js';

const connectionString = 'postgresql://postgres.vhmnajoeicasaigiophh:HVYbYVb1x2ErqzH4@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

class EventWorker {
  constructor() {
    this.pool = new pg.Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    this.running = false;
    this.handlers = new Map();
    this.pollInterval = null;
  }

  /**
   * Register a domain event handler/subscriber
   * 
   * @param {string} eventType 
   * @param {function} handlerFn - Async function (eventRecord, pgClient) => Promise<any>
   */
  subscribe(eventType, handlerFn) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType).push(handlerFn);
    console.log(`📡 Subscriber registered for event: [${eventType}]`);
  }

  /**
   * Start the outbox background polling worker
   */
  start(intervalMs = 1000) {
    if (this.running) return;
    this.running = true;
    console.log('👷 Transactional Outbox Event Worker started.');
    
    this.pollInterval = setInterval(() => {
      this.pollEvents().catch(err => {
        console.error('⚠️ Outbox Poller Error:', err.message);
      });
    }, intervalMs);
  }

  /**
   * Stop the outbox background worker
   */
  async stop() {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    await this.pool.end();
    console.log('👷 Transactional Outbox Event Worker stopped.');
  }

  /**
   * Concurrency-safe, transactional outbox database poller
   */
  async pollEvents() {
    const client = await this.pool.connect();
    try {
      // Begin PostgreSQL ACID transaction
      await client.query('BEGIN;');

      // Select oldest pending events, locking rows to prevent multi-worker concurrency collisons
      const selectQuery = `
        SELECT * FROM domain_events
        WHERE status = 'pending' AND attempts < 5
        ORDER BY created_at ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED;
      `;
      const res = await client.query(selectQuery);
      const events = res.rows;

      if (events.length === 0) {
        await client.query('COMMIT;');
        return;
      }

      console.log(`👷 Outbox worker locked ${events.length} pending events to process.`);

      for (const event of events) {
        await this.processEvent(client, event);
      }

      await client.query('COMMIT;');
    } catch (err) {
      await client.query('ROLLBACK;');
      console.error('❌ Transaction rolled back in Outbox Worker:', err.message);
    } finally {
      client.release();
    }
  }

  /**
   * Process a single outbox event record
   */
  async processEvent(client, event) {
    const handlers = this.handlers.get(event.event_type) || [];
    
    // Log initial process attempt
    const nextAttempts = event.attempts + 1;
    console.log(`  ➔ Processing [${event.event_type}] | ID: ${event.id} | Attempt: ${nextAttempts}`);

    try {
      // Execute all registered async handler functions
      for (const handler of handlers) {
        await handler(event.payload, client, event.tenant_id);
      }

      // Update event status to processed
      const updateQuery = `
        UPDATE domain_events
        SET status = 'processed', attempts = $1, error_log = NULL
        WHERE id = $2;
      `;
      await client.query(updateQuery, [nextAttempts, event.id]);
      console.log(`    ✅ Processed [${event.event_type}] successfully.`);
      
      // Notify real-time memory broker that the outbox event has been fully settled
      memoryBroker.emit(`outbox:${event.event_type}`, event);

    } catch (err) {
      console.error(`    ❌ Failed to process [${event.event_type}]:`, err.message);
      
      const isPermanentlyFailed = nextAttempts >= 5;
      const nextStatus = isPermanentlyFailed ? 'failed' : 'pending';
      
      const updateFailedQuery = `
        UPDATE domain_events
        SET status = $1, attempts = $2, error_log = $3
        WHERE id = $4;
      `;
      await client.query(updateFailedQuery, [nextStatus, nextAttempts, err.stack || err.message, event.id]);
      
      if (isPermanentlyFailed) {
        console.error(`      ⚠️ Event ID ${event.id} permanently failed after 5 attempts.`);
      }
    }
  }
}

// Single singleton instance shared by the Express application
export const eventWorker = new EventWorker();
