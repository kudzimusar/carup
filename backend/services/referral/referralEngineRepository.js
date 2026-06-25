import { DatabaseError } from '../../utils/errors.js';

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
  attributionJourneys: 'referral_attribution_journeys',
  attributionTouches: 'referral_attribution_touches',
});

function assertClient(client) {
  if (!client || typeof client.from !== 'function') {
    throw new DatabaseError('Referral repository requires a Supabase-compatible client.');
  }
}

function assertNoError(result, action) {
  if (result?.error) {
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
      if (options.orderBy) {
        query = query.order(options.orderBy, { ascending: options.ascending ?? false });
      }
      if (options.limit) {
        query = query.limit(options.limit);
      }
      const result = await query;
      return assertNoError(result, `list ${table}`) || [];
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
  };
}
