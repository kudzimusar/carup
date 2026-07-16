import { ConflictError, DatabaseError } from '../../utils/errors.js';

export const REFERRAL_TABLES = Object.freeze({
  campaigns: 'referral_campaigns',
  codes: 'referral_codes',
  events: 'referral_events',
  coupons: 'referral_coupons',
  couponRedemptions: 'referral_coupon_redemptions',
  wallets: 'referral_wallets',
  walletTransactions: 'referral_wallet_transactions',
  shareAssets: 'referral_share_assets',
  auditEvents: 'referral_admin_audit_events',
});

function assertClient(client) {
  if (!client || typeof client.from !== 'function') {
    throw new DatabaseError('Referral repository requires a Supabase-compatible client.');
  }
}

function isUniqueViolation(error = {}) {
  return error?.code === '23505' || /duplicate key|unique constraint/i.test(String(error?.message || ''));
}

function assertNoError(result, action) {
  if (result?.error) {
    if (isUniqueViolation(result.error)) {
      throw new ConflictError(`Referral repository ${action} conflicted with an existing row: ${result.error.message}`, result.error);
    }
    throw new DatabaseError(`Referral repository ${action} failed: ${result.error.message}`, result.error);
  }
  return result?.data;
}

function applyFilters(query, filters = {}) {
  let next = query;
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    next = next.eq(key, value);
  }
  return next;
}

export function createSupabaseReferralRepository(client) {
  assertClient(client);

  return {
    async insert(table, payload) {
      const result = await client.from(table).insert(payload).select().single();
      return assertNoError(result, `insert into ${table}`);
    },

    async list(table, filters = {}, options = {}) {
      let query = applyFilters(client.from(table).select(options.select || '*'), filters);
      if (options.jsonContains) {
        for (const [key, value] of Object.entries(options.jsonContains)) {
          query = query.contains(key, value);
        }
      }
      if (options.orderBy) {
        query = query.order(options.orderBy, { ascending: options.ascending ?? false });
      }
      if (options.limit && options.offset !== undefined) {
        const limit = Number(options.limit);
        const offset = Number(options.offset || 0);
        if (Number.isFinite(limit) && Number.isFinite(offset) && limit > 0 && offset >= 0) {
          query = query.range(offset, offset + limit - 1);
        }
      } else if (options.limit) {
        query = query.limit(options.limit);
      }
      const result = await query;
      return assertNoError(result, `list ${table}`) || [];
    },

    async listIn(table, column, values = [], filters = {}, options = {}) {
      const uniqueValues = [...new Set((values || []).filter((value) => value !== undefined && value !== null && value !== ''))];
      if (!uniqueValues.length) return [];
      let query = applyFilters(client.from(table).select(options.select || '*'), filters).in(column, uniqueValues);
      if (options.jsonContains) {
        for (const [key, value] of Object.entries(options.jsonContains)) {
          query = query.contains(key, value);
        }
      }
      if (options.orderBy) {
        query = query.order(options.orderBy, { ascending: options.ascending ?? false });
      }
      if (options.limit && options.offset !== undefined) {
        const limit = Number(options.limit);
        const offset = Number(options.offset || 0);
        if (Number.isFinite(limit) && Number.isFinite(offset) && limit > 0 && offset >= 0) {
          query = query.range(offset, offset + limit - 1);
        }
      } else if (options.limit) {
        query = query.limit(options.limit);
      }
      const result = await query;
      return assertNoError(result, `list ${table} where ${column} in (...)`) || [];
    },

    async findOne(table, filters = {}, options = {}) {
      const query = applyFilters(client.from(table).select(options.select || '*'), filters);
      const result = await query.maybeSingle();
      return assertNoError(result, `find one ${table}`) || null;
    },

    async updateById(table, id, patch) {
      const result = await client.from(table).update(patch).eq('id', id).select().single();
      return assertNoError(result, `update ${table}`);
    },

    async count(table, filters = {}) {
      const result = await applyFilters(client.from(table).select('*', { count: 'exact', head: true }), filters);
      if (result?.error) {
        throw new DatabaseError(`Referral repository count ${table} failed: ${result.error.message}`, result.error);
      }
      return result?.count || 0;
    },

    async countIn(table, column, values = [], filters = {}, options = {}) {
      const uniqueValues = [...new Set((values || []).filter((value) => value !== undefined && value !== null && value !== ''))];
      if (!uniqueValues.length) return 0;
      let query = applyFilters(client.from(table).select('*', { count: 'exact', head: true }), filters).in(column, uniqueValues);
      if (options.jsonContains) {
        for (const [key, value] of Object.entries(options.jsonContains)) {
          query = query.contains(key, value);
        }
      }
      const result = await query;
      if (result?.error) {
        throw new DatabaseError(`Referral repository count ${table} where ${column} in (...) failed: ${result.error.message}`, result.error);
      }
      return result?.count || 0;
    },
  };
}

export const __referralRepositoryInternals = { isUniqueViolation };
