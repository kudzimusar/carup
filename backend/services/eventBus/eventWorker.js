import dotenv from 'dotenv';
import pg from 'pg';
import { memoryBroker } from './eventBusService.js';
import { asyncStore } from '../../utils/context.js';
import { logger } from '../../utils/logger.js';
import { Sentry } from '../ai/sentry.js';
import { metricsHub } from '../metrics.js';

dotenv.config();

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.warn('⚠️ Event worker database URL missing. Set DATABASE_URL or SUPABASE_DB_URL to enable transactional outbox polling.');
}

class EventWorker {
  constructor() {
    this.pool = connectionString ? new pg.Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    }) : null;
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
    logger.info('QUEUE', `Subscriber registered for event: [${eventType}]`);
  }

  /**
   * Start the outbox background polling worker
   */
  start(intervalMs = 1000) {
    if (this.running) return;
    this.running = true;
    logger.info('QUEUE', 'Transactional Outbox Event Worker started.');
    
    this.pollInterval = setInterval(() => {
      this.pollEvents().catch(err => {
        logger.error('QUEUE', `Outbox Poller Error: ${err.message}`, { error: err });
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
    if (this.pool) await this.pool.end();
    logger.info('QUEUE', 'Transactional Outbox Event Worker stopped.');
  }

  /**
   * Concurrency-safe, transactional outbox database poller
   */
  async pollEvents() {
    if (!this.pool) {
      console.warn('⚠️ Outbox poll skipped because DATABASE_URL/SUPABASE_DB_URL is not configured.');
      return;
    }

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

      // Query total pending outbox backlog count
      const backlogRes = await client.query(`
        SELECT COUNT(*) as count FROM domain_events
        WHERE status = 'pending' AND attempts < 5;
      `);
      const backlogCount = parseInt(backlogRes.rows[0].count, 10);
      metricsHub.recordOutboxBatch(backlogCount);

      if (events.length === 0) {
        await client.query('COMMIT;');
        return;
      }

      logger.info('QUEUE', `Outbox worker locked ${events.length} pending events to process. Current backlog: ${backlogCount}`);

      for (const event of events) {
        await this.processEvent(client, event);
      }

      await client.query('COMMIT;');
    } catch (err) {
      await client.query('ROLLBACK;');
      logger.error('QUEUE', `Transaction rolled back in Outbox Worker: ${err.message}`, { error: err });
    } finally {
      client.release();
    }
  }

  /**
   * Process a single outbox event record
   */
  async processEvent(client, event) {
    const handlers = this.handlers.get(event.event_type) || [];
    const nextAttempts = event.attempts + 1;
    
    // Resolve context correlation and tenant parameters
    const correlationId = event.payload?.correlationId || event.payload?.correlation_id || `corr-outbox-${event.id}`;
    const tenantId = event.tenant_id || event.payload?.tenantId || null;

    const startTime = Date.now();
    logger.info('QUEUE', `Processing [${event.event_type}] | ID: ${event.id} | Attempt: ${nextAttempts}`, {
      eventId: event.id,
      correlationId,
      tenantId
    });

    try {
      // Run handlers within the correlation AsyncLocalStorage boundaries
      await asyncStore.run({ correlationId, tenantId }, async () => {
        for (const handler of handlers) {
          await handler(event.payload, client, event.tenant_id);
        }
      });

      const elapsedMs = Date.now() - startTime;

      // Update event status to processed
      const updateQuery = `
        UPDATE domain_events
        SET status = 'processed', attempts = $1, error_log = NULL
        WHERE id = $2;
      `;
      await client.query(updateQuery, [nextAttempts, event.id]);
      
      logger.info('QUEUE', `Processed [${event.event_type}] successfully in ${elapsedMs}ms`, {
        eventId: event.id,
        durationMs: elapsedMs
      });
      
      metricsHub.recordOutboxSuccess(event.event_type, elapsedMs);

      // Notify real-time memory broker that the outbox event has been fully settled
      memoryBroker.emit(`outbox:${event.event_type}`, event);

    } catch (err) {
      const elapsedMs = Date.now() - startTime;
      logger.error('QUEUE', `Failed to process [${event.event_type}] in ${elapsedMs}ms: ${err.message}`, {
        eventId: event.id,
        error: err
      });
      
      const isPermanentlyFailed = nextAttempts >= 5;
      const nextStatus = isPermanentlyFailed ? 'failed' : 'pending';
      
      const updateFailedQuery = `
        UPDATE domain_events
        SET status = $1, attempts = $2, error_log = $3
        WHERE id = $4;
      `;
      await client.query(updateFailedQuery, [nextStatus, nextAttempts, err.stack || err.message, event.id]);
      
      metricsHub.recordOutboxFailure(event.event_type, nextAttempts);

      if (isPermanentlyFailed) {
        logger.error('QUEUE', `Event ID ${event.id} permanently failed after 5 attempts.`);
        Sentry.captureException(err, {
          eventType: event.event_type,
          eventId: event.id,
          attempts: nextAttempts
        });
      }
    }
  }
}

// Single singleton instance shared by the Express application
export const eventWorker = new EventWorker();
