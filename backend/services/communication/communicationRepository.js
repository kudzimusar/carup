import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import {
  buildThreadQuery, computeCounts, decodeCursor, encodeCursor, clampLimit, THREAD_SORT_KEYS,
} from './communicationThreadQuery.js';
import { projectInboxThreads } from './communicationInboxProjection.js';

// The search_communication_threads() RPC hard-caps returned rows at 200 (LEAST(..., 200)). The
// repository must clamp its effective page size to this so keyset has_more stays correct.
const RPC_MAX_PAGE = 200;

// A PostgREST "no such function in the schema cache" error — used to gracefully fall back to the
// bounded-window query engine ONLY when the projection RPC has not been deployed yet. Intentionally
// narrow: it must NOT match genuine runtime SQL faults (missing column 42703, relation 42P01, or an
// "operator does not exist" 42883), which must surface rather than silently degrade the endpoint.
function isMissingFunctionError(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return code === 'PGRST202'
    || msg.includes('could not find the function')
    || msg.includes('schema cache');
}

// Normalise a queue/filter param set into the arguments both query paths share.
function normalizeSearchParams(params = {}) {
  const splitCsv = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
  const includeTerminal = params.include_terminal === undefined
    ? true
    : !(params.include_terminal === false || params.include_terminal === 'false');
  return {
    search: params.search ? String(params.search) : null,
    statusList: params.status ? splitCsv(params.status) : null,
    channelList: params.channel ? splitCsv(params.channel) : null,
    assigned: params.assigned ? String(params.assigned) : null,
    team: params.team ? String(params.team) : null,
    sla: params.sla ? String(params.sla) : null,
    includeTerminal,
    sort: THREAD_SORT_KEYS.includes(params.sort) ? params.sort : 'newest',
    limit: clampLimit(params.limit),
    cursor: params.cursor || null,
  };
}

// Map the `assigned` queue param to a concrete assignee id for the RPC (`mine` → the caller);
// the pseudo-values unassigned/assigned/failed are handled by dedicated boolean params/filters.
function resolveAssignee(assigned, ctx) {
  if (!assigned) return null;
  if (assigned === 'mine') return ctx.userId ?? null;
  if (['unassigned', 'assigned', 'failed'].includes(assigned)) return null;
  return assigned;
}

// Tenant/platform scoping: platform admins see every tenant; a tenant-scoped caller only ever sees
// its own tenant, and a caller with no resolvable tenant sees nothing (fail-closed). Item 14.
function scopeThreads(threads, ctx) {
  if (ctx.isPlatform) return threads;
  if (!ctx.tenantId) return [];
  return threads.filter((t) => String(t.tenant_id || '') === String(ctx.tenantId));
}

// Run the pure query engine over an already-projected, already-scoped row set (the memory path and
// the real-repo window fallback share this).
function runQuery(rows, params, ctx, p) {
  const result = buildThreadQuery(rows, {
    search: p.search,
    status: params.status,
    channel: params.channel,
    priority: params.priority,
    assigned: p.assigned,
    sla: p.sla,
    unassigned: p.assigned === 'unassigned',
    failed_only: Boolean(params.failed_only) || p.assigned === 'failed',
    include_terminal: p.includeTerminal,
    sort: p.sort,
    cursor: p.cursor,
    limit: p.limit,
  }, { userId: ctx.userId, now: ctx.now ?? Date.now() });
  result.page.mode = result.page.mode || 'window';
  return result;
}

function createServiceClientFromEnv() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for CommunicationRepository.');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
}

export class CommunicationRepository {
  constructor({ client = null } = {}) {
    this.client = client || createServiceClientFromEnv();
  }

  async insert(table, row) {
    const { data, error } = await this.client.from(table).insert(row).select().single();
    if (error && table === 'notification_queue' && row.id === undefined && /null value.*id|violates not-null constraint/i.test(error.message || '')) {
      const retryRow = { id: randomUUID(), ...row };
      const retry = await this.client.from(table).insert(retryRow).select().single();
      if (retry.error) throw this.toDatabaseError(`${table} insert failed: ${retry.error.message}`, retry.error);
      return retry.data || retryRow;
    }
    if (error) throw this.toDatabaseError(`${table} insert failed: ${error.message}`, error);
    return data || row;
  }

  toDatabaseError(message, error = {}) {
    const failure = new Error(message);
    if (error.code) failure.code = error.code;
    if (error.details) failure.details = error.details;
    if (error.hint) failure.hint = error.hint;
    return failure;
  }

  async upsert(table, row, options = {}) {
    const { data, error } = await this.client.from(table).upsert(row, options).select().single();
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    return data || row;
  }

  async findOne(table, filters = {}) {
    let query = this.client.from(table).select('*');
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined) continue;
      query = value === null ? query.is(key, null) : query.eq(key, value);
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`${table} lookup failed: ${error.message}`);
    return data || null;
  }

  async list(table, filters = {}, options = {}) {
    let query = this.client.from(table).select(options.select || '*');
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) query = query.in(key, value);
      else query = value === null ? query.is(key, null) : query.eq(key, value);
    }
    // Strictly-greater-than, for bounded reconciliation scans that must exclude everything at or
    // before a durable activation watermark. Expressed here rather than filtered in JS so the query
    // stays an index range instead of pulling history across the wire to discard it.
    if (options.gt) query = query.gt(options.gt.column, options.gt.value);
    if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending ?? false });
    if (options.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error) throw new Error(`${table} list failed: ${error.message}`);
    return data || [];
  }

  /**
   * Conditional delete returning the AFFECTED ROW COUNT.
   *
   * The count is the point: the reconciliation queue retires work with an atomic compare-and-delete
   * on (id, generation, fingerprint), and "0 rows affected" is the signal that a newer generation
   * arrived mid-flight and must survive. A delete that cannot report that is unusable here.
   */
  async deleteWhere(table, filters) {
    let query = this.client.from(table).delete();
    for (const [key, value] of Object.entries(filters)) {
      query = value === null ? query.is(key, null) : query.eq(key, value);
    }
    const { data, error } = await query.select('id');
    if (error) throw new Error(`${table} delete failed: ${error.message}`);
    return (data || []).length;
  }

  /** Update by an arbitrary single-column key. */
  async updateWhere(table, filters, patch) {
    let query = this.client.from(table).update(patch);
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const { error } = await query;
    if (error) throw new Error(`${table} update failed: ${error.message}`);
    return true;
  }

  async updateById(table, id, patch) {
    const { data, error } = await this.client.from(table).update(patch).eq('id', id).select().single();
    if (error) throw new Error(`${table} update failed: ${error.message}`);
    return data;
  }

  async deleteById(table, id) {
    const { data, error } = await this.client.from(table).delete().eq('id', id).select().maybeSingle();
    if (error) throw new Error(`${table} delete failed: ${error.message}`);
    return data || null;
  }

  async updateWhere(table, filters, patch) {
    let query = this.client.from(table).update(patch);
    for (const [key, value] of Object.entries(filters)) {
      query = value === null ? query.is(key, null) : query.eq(key, value);
    }
    const { data, error } = await query.select();
    if (error) throw new Error(`${table} update failed: ${error.message}`);
    return data || [];
  }

  async claimDueNotifications({ workerId, limit = 10, staleAfterSeconds = 900 } = {}) {
    const { data, error } = await this.client.rpc('claim_due_communication_notifications', {
      p_worker_id: workerId,
      p_batch_limit: limit,
      p_stale_after_seconds: staleAfterSeconds,
    });
    if (error) throw new Error(`notification_queue claim failed: ${error.message}`);
    return data || [];
  }

  // Identity-first inbox query. For the default (newest) ordering this executes fully DB-side via the
  // search_communication_threads() RPC over the communication_inbox_threads projection view (keyset
  // pagination, tenant scoping, server search/filter/count). Non-default sorts, or a DB where the
  // projection migration is not yet applied, fall back to the bounded-window engine over a JS
  // projection so behaviour degrades gracefully rather than breaking.
  async searchThreads(params = {}, ctx = {}) {
    const p = normalizeSearchParams(params);
    if (p.sort === 'newest') {
      try {
        return await this.searchThreadsViaRpc(params, ctx, p);
      } catch (error) {
        if (!isMissingFunctionError(error)) throw error;
        // Projection migration not applied yet — degrade to the window engine.
      }
    }
    return this.searchThreadsViaWindow(params, ctx, p);
  }

  async searchThreadsViaRpc(params, ctx, p) {
    const cursor = decodeCursor(p.cursor);
    // The RPC hard-caps returned rows at 200 (LEAST(..., 200)); align the effective page size so
    // has_more never false-negatives for larger requested limits (which would strand later rows).
    const effectiveLimit = Math.min(p.limit, RPC_MAX_PAGE);
    const { data, error } = await this.client.rpc('search_communication_threads', {
      p_tenant_id: ctx.tenantId ?? null,
      p_is_platform: Boolean(ctx.isPlatform),
      p_search: p.search,
      p_status: p.statusList,
      p_channel: p.channelList,
      p_assignee: resolveAssignee(p.assigned, ctx),
      p_team: p.team,
      p_sla: p.sla,
      p_unassigned: p.assigned === 'unassigned',
      p_assigned_only: p.assigned === 'assigned',
      p_failed_only: Boolean(params.failed_only) || p.assigned === 'failed',
      p_include_terminal: p.includeTerminal,
      p_cursor_ts: cursor?.[0] ?? null,
      p_cursor_id: cursor?.[1] != null ? String(cursor[1]) : null,
      p_limit: effectiveLimit,
    });
    if (error) throw this.toDatabaseError(`thread search failed: ${error.message}`, error);
    const rows = data || [];
    const hasMore = rows.length >= effectiveLimit;
    const last = rows[rows.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor([last.last_message_at || last.created_at || '', String(last.id)])
      : null;
    // The DB does the heavy filter/sort/paginate over the whole set; enrich only the RETURNED PAGE
    // (≤200 rows) with per-agent unread (P1.7) + registered-user identity fallback (P1.8) via the same
    // tested projection, so the view's team-based unread is replaced by the acting agent's own count.
    const threads = await this.enrichPage(rows, ctx);
    const counts = await this.threadCounts(params, ctx);
    return {
      threads,
      page: { sort: 'newest', mode: 'db_keyset', limit: effectiveLimit, returned: threads.length, has_more: hasMore, next_cursor: nextCursor },
      counts,
    };
  }

  // Re-project just the returned page through the pure projection so per-agent unread + the
  // registered-user identity fallback are applied consistently with the window/memory path.
  async enrichPage(rows, ctx) {
    if (!rows.length) return rows;
    const ids = rows.map((r) => r.id);
    const [participants, messages] = await Promise.all([
      this.list('message_participants', { thread_id: ids }),
      this.list('messages', { thread_id: ids }),
    ]);
    const identityIds = [...new Set(participants.map((row) => row.external_identity_id).filter(Boolean))];
    const identities = identityIds.length ? await this.list('channel_identities', { id: identityIds }) : [];
    const userIds = [...new Set(rows.map((r) => r.primary_user_id).filter(Boolean))];
    const users = userIds.length ? await this.list('users', { id: userIds }).catch(() => []) : [];
    return projectInboxThreads(rows, { participants, identities, messages, users }, { agentId: ctx.userId ?? null });
  }

  async searchThreadsViaWindow(params, ctx, p) {
    const projected = await this.projectThreadWindow(ctx);
    return runQuery(scopeThreads(projected, ctx), params, ctx, p);
  }

  async projectThreadWindow(ctx = {}) {
    const windowSize = Math.min(Number(process.env.COMMUNICATION_THREAD_WINDOW || 1000), 2000);
    const threadRows = await this.list('message_threads', {}, { order: { column: 'updated_at' }, limit: windowSize });
    if (!threadRows.length) return [];
    const ids = threadRows.map((t) => t.id);
    const [participants, messages] = await Promise.all([
      this.list('message_participants', { thread_id: ids }),
      this.list('messages', { thread_id: ids }),
    ]);
    const identityIds = [...new Set(participants.map((row) => row.external_identity_id).filter(Boolean))];
    const identities = identityIds.length ? await this.list('channel_identities', { id: identityIds }) : [];
    // Registered-user identity fallback (P1.8): resolve threads with no requester channel identity to
    // their CarUp user profile via primary_user_id.
    const userIds = [...new Set(threadRows.map((t) => t.primary_user_id).filter(Boolean))];
    const users = userIds.length ? await this.list('users', { id: userIds }).catch(() => []) : [];
    return projectInboxThreads(threadRows, { participants, identities, messages, users }, { agentId: ctx.userId ?? null });
  }

  async threadCounts(params = {}, ctx = {}) {
    try {
      const { data, error } = await this.client.rpc('communication_thread_counts', {
        p_tenant_id: ctx.tenantId ?? null,
        p_is_platform: Boolean(ctx.isPlatform),
        p_user_id: ctx.userId ?? null,
      });
      if (error) throw this.toDatabaseError(`thread counts failed: ${error.message}`, error);
      return data || {};
    } catch (error) {
      if (!isMissingFunctionError(error)) throw error;
      const projected = await this.projectThreadWindow(ctx);
      return computeCounts(scopeThreads(projected, ctx), { userId: ctx.userId, now: ctx.now ?? Date.now() });
    }
  }
}

export class MemoryCommunicationRepository {
  constructor(seed = {}, options = {}) {
    this.tables = new Map();
    this.options = options;
    this.numericCounters = new Map();
    // Seed the canonical communication tables PLUS any additional tables provided in the seed (e.g.
    // users, communication_sla_policies, communication_audit_events), so callers can seed anything.
    const canonical = [
      'message_threads',
      'message_participants',
      'messages',
      'channel_identities',
      'notification_queue',
      'message_delivery_attempts',
      'webhook_logs',
      'communication_preferences',
      'communication_escalations',
      'domain_events',
    ];
    for (const table of new Set([...canonical, ...Object.keys(seed)])) {
      this.tables.set(table, [...(seed[table] || [])]);
      const numericIds = (seed[table] || [])
        .map((row) => Number(row.id))
        .filter((id) => Number.isInteger(id) && id > 0);
      this.numericCounters.set(table, numericIds.length ? Math.max(...numericIds) : 0);
    }
  }

  rows(table) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table);
  }

  matches(row, filters = {}) {
    return Object.entries(filters).every(([key, value]) => {
      if (value === undefined) return true;
      if (Array.isArray(value)) return value.includes(row[key]);
      return row[key] === value;
    });
  }

  async insert(table, row) {
    if (table === 'notification_queue' && this.options.strictNotificationQueueColumns) {
      const allowed = new Set(this.options.notificationQueueColumns || [
        'id',
        'tenant_id',
        'recipient_id',
        'recipient_user_id',
        'recipient_identity_id',
        'thread_id',
        'message_id',
        'event_id',
        'type',
        'notification_type',
        'title',
        'message',
        'channel',
        'provider',
        'template_key',
        'payload',
        'priority',
        'status',
        'dedupe_key',
        'scheduled_at',
        'next_attempt_at',
        'attempt_count',
        'max_attempts',
        'read',
        'created_at',
        'updated_at',
        'metadata',
        'locked_at',
        'locked_by',
        'last_error',
        'dead_lettered_at',
      ]);
      const unsupported = Object.keys(row).filter((key) => !allowed.has(key));
      if (unsupported.length) {
        throw new Error(`notification_queue column not allowed by migrated schema: ${unsupported.join(', ')}`);
      }
    }
    if (table === 'notification_queue' && this.options.legacyNotificationQueueIds && row.id !== undefined && !Number.isInteger(Number(row.id))) {
      throw new Error('invalid input syntax for type bigint');
    }
    if (table === 'notification_queue' && this.options.legacyTextNotificationQueueRequiresExplicitId && row.id === undefined) {
      row = { id: randomUUID(), ...row };
    }
    const id = row.id || (table === 'notification_queue' && this.options.legacyNotificationQueueIds
      ? this.nextNumericId(table)
      : randomUUID());
    const record = {
      id,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString(),
      ...row,
      id,
    };
    if (table === 'notification_queue' && !record.dedupe_key) record.dedupe_key = record.id;
    if (table === 'notification_queue' && record.dedupe_key && this.rows(table).some((r) => r.dedupe_key === record.dedupe_key)) {
      const err = new Error('duplicate key value violates unique constraint "idx_notification_queue_dedupe"');
      err.code = '23505';
      throw err;
    }
    if (table === 'webhook_logs' && record.dedupe_key && this.rows(table).some((r) => r.dedupe_key === record.dedupe_key)) {
      const err = new Error('duplicate webhook');
      err.code = '23505';
      throw err;
    }
    if (table === 'channel_identities') {
      const tenantKey = record.tenant_id || 'platform';
      const providerKey = record.provider || 'default';
      const duplicate = this.rows(table).some((r) => (
        (r.tenant_id || 'platform') === tenantKey
        && r.channel === record.channel
        && (r.provider || 'default') === providerKey
        && r.external_id === record.external_id
      ));
      if (duplicate) {
        const err = new Error('duplicate key value violates unique constraint "idx_channel_identities_unique"');
        err.code = '23505';
        throw err;
      }
    }
    if (table === 'messages' && record.provider_message_id) {
      const duplicate = this.rows(table).some((r) => r.provider === record.provider && r.provider_message_id === record.provider_message_id);
      if (duplicate) {
        const err = new Error('duplicate key value violates unique constraint "idx_messages_provider_message"');
        err.code = '23505';
        throw err;
      }
    }
    this.rows(table).push(record);
    return record;
  }

  nextNumericId(table) {
    const next = Number(this.numericCounters.get(table) || 0) + 1;
    this.numericCounters.set(table, next);
    return next;
  }

  async upsert(table, row) {
    const rows = this.rows(table);
    const index = rows.findIndex((existing) => existing.id === row.id || (row.dedupe_key && existing.dedupe_key === row.dedupe_key));
    if (index >= 0) {
      rows[index] = { ...rows[index], ...row, updated_at: new Date().toISOString() };
      return rows[index];
    }
    return this.insert(table, row);
  }

  async findOne(table, filters = {}) {
    return this.rows(table).find((row) => this.matches(row, filters)) || null;
  }

  async list(table, filters = {}, options = {}) {
    let rows = this.rows(table).filter((row) => this.matches(row, filters));
    // Mirrors the PostgREST `gt` above; a memory repository that silently ignored it would let a
    // reconciliation test pass while the real scan returned all of history.
    if (options.gt) {
      const { column, value } = options.gt;
      rows = rows.filter((row) => row[column] != null && new Date(row[column]) > new Date(value));
    }
    if (options.order) {
      const { column, ascending = false } = options.order;
      rows = rows.sort((a, b) => String(a[column] || '').localeCompare(String(b[column] || '')) * (ascending ? 1 : -1));
    }
    if (options.limit) rows = rows.slice(0, Number(options.limit));
    return rows;
  }

  async deleteWhere(table, filters) {
    const rows = this.rows(table);
    const matches = rows.filter((row) => Object.entries(filters)
      .every(([k, v]) => (v === null ? row[k] == null : String(row[k] ?? '') === String(v ?? ''))));
    for (const row of matches) rows.splice(rows.indexOf(row), 1);
    return matches.length;
  }

  async updateWhere(table, filters, patch) {
    this.rows(table)
      .filter((row) => Object.entries(filters).every(([k, v]) => String(row[k] ?? '') === String(v ?? '')))
      .forEach((row) => Object.assign(row, patch));
    return true;
  }

  async updateById(table, id, patch) {
    const rows = this.rows(table);
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) throw new Error(`${table} row not found`);
    rows[index] = { ...rows[index], ...patch, updated_at: patch.updated_at || new Date().toISOString() };
    return rows[index];
  }

  async deleteById(table, id) {
    const rows = this.rows(table);
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return null;
    const [deleted] = rows.splice(index, 1);
    return deleted;
  }

  async updateWhere(table, filters, patch) {
    const rows = this.rows(table);
    const updated = [];
    for (let i = 0; i < rows.length; i += 1) {
      if (this.matches(rows[i], filters)) {
        rows[i] = { ...rows[i], ...patch, updated_at: patch.updated_at || new Date().toISOString() };
        updated.push(rows[i]);
      }
    }
    return updated;
  }

  async claimDueNotifications({ workerId = 'memory-worker', limit = 10, staleAfterSeconds = 900 } = {}) {
    const now = new Date();
    const staleMs = Number(staleAfterSeconds || 900) * 1000;
    const eligible = this.rows('notification_queue')
      .filter((row) => {
        const status = String(row.status || '').toLowerCase();
        const dueAt = row.next_attempt_at || row.scheduled_at || row.created_at;
        const due = !dueAt || new Date(dueAt) <= now;
        const staleProcessing = status === 'processing' && row.locked_at && (now.getTime() - new Date(row.locked_at).getTime()) > staleMs;
        return ((['queued', 'retry_scheduled'].includes(status) && due) || staleProcessing) && !row.dead_lettered_at;
      })
      .sort((a, b) => String(a.next_attempt_at || a.scheduled_at || a.created_at || '').localeCompare(String(b.next_attempt_at || b.scheduled_at || b.created_at || '')))
      .slice(0, Number(limit || 10));
    const claimed = [];
    for (const row of eligible) {
      claimed.push(await this.updateById('notification_queue', row.id, {
        status: 'processing',
        locked_at: now.toISOString(),
        locked_by: workerId,
        attempt_count: Number(row.attempt_count || 0) + 1,
      }));
    }
    return claimed;
  }

  // JS mirror of the projection view + RPC (same code path the real repo falls back to), so tests
  // exercise the identity projection, tenant scoping, keyset pagination, and counts end to end.
  projectAll(ctx = {}) {
    return projectInboxThreads(this.rows('message_threads'), {
      participants: this.rows('message_participants'),
      identities: this.rows('channel_identities'),
      messages: this.rows('messages'),
      users: this.rows('users'),
    }, { agentId: ctx.userId ?? null });
  }

  async searchThreads(params = {}, ctx = {}) {
    const p = normalizeSearchParams(params);
    const scoped = scopeThreads(this.projectAll(ctx), ctx);
    return runQuery(scoped, params, ctx, p);
  }

  async threadCounts(params = {}, ctx = {}) {
    const scoped = scopeThreads(this.projectAll(ctx), ctx);
    return computeCounts(scoped, { userId: ctx.userId, now: ctx.now ?? Date.now() });
  }
}
