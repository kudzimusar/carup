import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

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
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    return data || row;
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
    if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending ?? false });
    if (options.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error) throw new Error(`${table} list failed: ${error.message}`);
    return data || [];
  }

  async updateById(table, id, patch) {
    const { data, error } = await this.client.from(table).update(patch).eq('id', id).select().single();
    if (error) throw new Error(`${table} update failed: ${error.message}`);
    return data;
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
}

export class MemoryCommunicationRepository {
  constructor(seed = {}) {
    this.tables = new Map();
    for (const table of [
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
    ]) {
      this.tables.set(table, [...(seed[table] || [])]);
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
    const record = {
      id: row.id || randomUUID(),
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString(),
      ...row,
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
    this.rows(table).push(record);
    return record;
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
    if (options.order) {
      const { column, ascending = false } = options.order;
      rows = rows.sort((a, b) => String(a[column] || '').localeCompare(String(b[column] || '')) * (ascending ? 1 : -1));
    }
    if (options.limit) rows = rows.slice(0, Number(options.limit));
    return rows;
  }

  async updateById(table, id, patch) {
    const rows = this.rows(table);
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) throw new Error(`${table} row not found`);
    rows[index] = { ...rows[index], ...patch, updated_at: patch.updated_at || new Date().toISOString() };
    return rows[index];
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
}
