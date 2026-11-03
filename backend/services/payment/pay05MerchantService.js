/**
 * CARUP-PAY-05-LR01 — a garage's OWN Paynow merchant: connection by the garage, verification by CarUp.
 *
 *  - The garage administrator connects the garage's Paynow merchant: legal profile, settlement account (last four digits
 *    only), and one integration per currency (ID, key, enabled methods). The key is sealed here with AES-256-GCM, bound to
 *    tenant / merchant / currency / integration ID / mode, before anything is written; it is never returned, logged or
 *    shown again (only a short one-way fingerprint).
 *  - The integration mode is the SERVER's (CARUP_PAY05_PAYNOW_MODE): a browser can never choose real Paynow. Level 1
 *    permits 'simulator' only.
 *  - An integration ID is reserved only once its key is proved: the server probes each one at connect (an authenticated
 *    trace of a random merchant trace), before anything is written, and every refusal reads the same (PAY-05-R1, ICR-S2).
 *  - A CarUp platform administrator verifies: the server itself probes every pending integration again and the database
 *    refuses verification without complete evidence, by the registrant, or by any member of the garage. Each integration
 *    needs its own settlement currency, reviewed in the merchant's Paynow account: Paynow's API reports none (ICR-P1).
 */
import crypto from 'node:crypto';
import { supabase as defaultDb } from '../../db/supabase.js';
import { GARAGE_ADMIN_ROLES } from '../serviceNetwork/serviceAuthority.js';
import {
  Pay05Error, PAY05_CURRENCIES, PAY05_GATEWAY, PAY05_METHODS, PAY05_MODES, PAY05_PAYNOW_CAPABILITIES, isPay05Enabled,
  pay05Failure, requirePay05Enabled,
} from './pay05Contract.js';
import { integrationKeyAad, integrationKeyFingerprint, openIntegrationKey, sealIntegrationKey } from './pay05CredentialVault.js';
import { createPaynowAdapter } from './pay05PaynowAdapter.js';
import { newMerchantTrace, normalizeIntegrationKey } from './pay05PaynowProtocol.js';

const list = (data) => (Array.isArray(data) ? data : data ? [data] : []);
const text = (value, { min = 2, max = 160 } = {}) => {
  const t = String(value ?? '').trim();
  return t.length >= min && t.length <= max ? t : null;
};

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw pay05Failure(error);
  return data;
}

async function read(promise, code = 'PAY05_READ_UNAVAILABLE') {
  const { data, error } = await promise;
  if (error) throw new Pay05Error(code, 503);
  return data;
}

function actorId(actor = {}) {
  const id = String(actor.id ?? '').trim();
  if (!id) throw new Pay05Error('PAY05_AUTHENTICATION_REQUIRED', 401);
  return id;
}

/** The server's Paynow mode for new integrations. Level 1: the local protocol simulator only. */
export function serverPaynowMode(env = process.env) {
  const mode = String(env.CARUP_PAY05_PAYNOW_MODE ?? '');
  if (mode !== 'simulator') throw new Pay05Error(PAY05_MODES.includes(mode) ? 'PAY05_REAL_PROVIDER_NOT_AUTHORIZED' : 'PAY05_MODE_INVALID', 503);
  return mode;
}

/** An integration row WITHOUT its sealed material (what any API may show). */
export function integrationView(row) {
  if (!row) return null;
  return {
    id: row.id, currency: row.currency, integration_id: row.integration_id, methods: row.methods, mode: row.mode,
    status: row.status, credential_fingerprint: row.credential_fingerprint, registered_at: row.registered_at,
    verified_at: row.verified_at, verified_by: row.verified_by, closed_at: row.closed_at, closed_reason: row.closed_reason,
    probe: row.verification_evidence?.credential_probe
      ? { result: row.verification_evidence.credential_probe.result, probed_at: row.verification_evidence.credential_probe.probed_at }
      : null,
    currency_evidence: row.currency_evidence
      ? { settlement_currency: row.currency_evidence.settlement_currency, reference: row.currency_evidence.reference, reviewed_at: row.currency_evidence.reviewed_at }
      : null,
  };
}

/** What a garage reads about its own merchant: CarUp operators' identities and internal notes stay with operators (ICR Info). */
function forGarage(bundle) {
  if (!bundle) return bundle;
  return {
    ...bundle,
    // the operator's note on where it checked the settlement currency stays with operators (PFR-L11)
    integrations: bundle.integrations.map((i) => ({ ...i, verified_by: null, currency_evidence: i.currency_evidence
      ? { settlement_currency: i.currency_evidence.settlement_currency, reviewed_at: i.currency_evidence.reviewed_at } : null })),
    history: bundle.history.map((h) => (['admin', 'super_admin'].includes(h.actor_role)
      ? { ...h, actor: 'CarUp', detail: {} } : h)),
  };
}

export async function paynowAvailability(db) {
  const guard = (await read(db.from('pay05_runtime_guard').select('paynow_available, paynow_simulator_enabled, paynow_real_enabled, availability_note, updated_at, updated_by')
    .eq('singleton', true).maybeSingle())) || null;
  return guard ? {
    available: Boolean(guard.paynow_available), simulator_enabled: Boolean(guard.paynow_simulator_enabled),
    real_enabled: Boolean(guard.paynow_real_enabled), note: guard.availability_note, updated_at: guard.updated_at, updated_by: guard.updated_by,
  } : { available: false, simulator_enabled: false, real_enabled: false, note: null, updated_at: null, updated_by: null };
}

async function merchantBundle(db, account) {
  if (!account) return null;
  const [profile, integrations, history] = await Promise.all([
    read(db.from('pay05_merchant_profiles').select('legal_entity_name, registration_number, settlement_bank_name, settlement_account_last4, settlement_account_holder, attested_by, attested_at')
      .eq('merchant_account_id', account.id).maybeSingle()),
    read(db.from('pay05_merchant_integrations').select('*').eq('merchant_account_id', account.id).order('currency')),
    read(db.from('pay05_merchant_audit_events').select('seq, event_type, actor, actor_role, detail, created_at')
      .eq('merchant_account_id', account.id).order('seq', { ascending: false }).limit(25)),
  ]);
  return {
    id: account.id, tenant_id: account.tenant_id, gateway: account.gateway, display_name: account.display_name,
    merchant_reference: account.merchant_reference, currencies: account.currencies, status: account.status,
    registered_by: account.registered_by, registered_at: account.registered_at, suspended_at: account.suspended_at,
    suspended_reason: account.suspended_reason, profile: profile || null,
    integrations: list(integrations).map(integrationView),
    history: list(history),
    // independent review W9: the garage sees why CarUp did not verify it
    ...(() => {
      const closed = account.status === 'rejected' ? list(integrations).find((i) => i.status === 'rejected' && i.closed_reason) : null;
      return { rejected_reason: closed?.closed_reason ?? null, rejected_at: closed?.closed_at ?? null };
    })(),
  };
}

// ───────────────────────────── the garage ─────────────────────────────

export async function getGaragePaynowConnection({ db = defaultDb, env = process.env, actor = {} } = {}) {
  actorId(actor);
  if (!actor.tenantId) throw new Pay05Error('PAY05_GARAGE_REQUIRED', 403);
  const accounts = await read(db.from('pay04_garage_merchant_accounts').select('*').eq('tenant_id', actor.tenantId)
    .eq('gateway', PAY05_GATEWAY).order('registered_at', { ascending: false }).limit(5));
  const [current, ...previous] = list(accounts);
  let modeAllowed = false;
  try { serverPaynowMode(env); modeAllowed = true; } catch { modeAllowed = false; }
  return {
    enabled: isPay05Enabled(env),
    can_connect: isPay05Enabled(env) && modeAllowed && (!current || ['suspended', 'rejected'].includes(current.status)),
    mode: modeAllowed ? 'simulator' : null,
    availability: await paynowAvailability(db),
    capabilities: PAY05_PAYNOW_CAPABILITIES,
    methods: PAY05_METHODS,
    currencies: PAY05_CURRENCIES,
    merchant: forGarage(await merchantBundle(db, current)),
    previous: previous.map((p) => ({ id: p.id, status: p.status, registered_at: p.registered_at, suspended_reason: p.suspended_reason })),
  };
}

function connectionInput(body) {
  const display = text(body.display_name, { max: 120 });
  const legal = text(body.legal_entity_name);
  const bank = text(body.settlement_bank_name, { max: 80 });
  const holder = text(body.settlement_account_holder);
  const last4 = String(body.settlement_account_last4 ?? '').trim();
  const registration = String(body.registration_number ?? '').trim();
  if (!display || !legal || !bank || !holder) throw new Pay05Error('PAY05_PROFILE_INVALID', 422);
  if (!/^[0-9]{4}$/.test(last4)) throw new Pay05Error('PAY05_SETTLEMENT_ACCOUNT_INVALID', 422);
  if (registration && !/^[A-Za-z0-9/ .-]{2,40}$/.test(registration)) throw new Pay05Error('PAY05_REGISTRATION_NUMBER_INVALID', 422);
  if (body.attest !== true) throw new Pay05Error('PAY05_ATTESTATION_REQUIRED', 422);
  const items = Array.isArray(body.integrations) ? body.integrations : [];
  if (items.length < 1 || items.length > 2) throw new Pay05Error('PAY05_INTEGRATIONS_INVALID', 422);
  const seen = new Set();
  const integrations = items.map((item) => {
    const currency = String(item?.currency ?? '').trim();
    const integrationId = String(item?.integration_id ?? '').trim();
    const methods = [...new Set(Array.isArray(item?.methods) ? item.methods.map(String) : [])].sort();
    if (!PAY05_CURRENCIES.includes(currency)) throw new Pay05Error('PAY05_CURRENCY_NOT_SUPPORTED', 422);
    if (seen.has(currency)) throw new Pay05Error('PAY05_DUPLICATE_CURRENCY', 422);
    seen.add(currency);
    if (!/^[0-9]{1,12}$/.test(integrationId)) throw new Pay05Error('PAY05_INTEGRATION_ID_INVALID', 422);
    if (!methods.length || methods.some((m) => !PAY05_METHODS.includes(m))) throw new Pay05Error('PAY05_METHODS_INVALID', 422);
    if (methods.includes('innbucks') && currency !== 'USD') throw new Pay05Error('PAY05_METHOD_NOT_AVAILABLE', 422);
    // a key pasted with spaces or in upper case is normalised as Paynow renders a GUID (independent review P5)
    return { currency, integrationId, methods, key: normalizeIntegrationKey(item?.integration_key) };
  });
  return { display, legal, bank, holder, last4, registration: registration || null, integrations };
}

/** The garage's own administrator, read-only: the database's garage_ops03_assert_admin re-checks it when the row is written. */
async function assertCanConnect(db, tenantId, userId) {
  const member = list(await read(db.from('tenant_users').select('role').eq('tenant_id', tenantId).eq('user_id', userId).limit(1)))[0];
  if (!member || !GARAGE_ADMIN_ROLES.includes(member.role)) throw new Pay05Error('PAY05_MERCHANT_AUTHORITY_REFUSED', 403);
}

/** One refusal for a wrong key, another garage's ID, a rejected ID cooling down and a cool-down itself (ICR-S2). */
const notAccepted = () => new Pay05Error('PAY05_INTEGRATION_NOT_ACCEPTED', 409);
const CONNECT_PROBE_FAILURES_ALLOWED = 5;

/**
 * The garage proves it holds each key BEFORE anything is reserved. Only Paynow's authenticated reply proves it; Paynow being
 * unreachable refuses nobody and reserves nothing. Repeated failed proofs cool down without calling Paynow.
 */
async function proveKeyAtConnect(db, env, transport, tenantId, item, mode) {
  let result;
  try {
    const adapter = createPaynowAdapter({ integration: { integrationId: item.integrationId, key: item.key, currency: item.currency, methods: item.methods, mode },
      merchantReference: null, env, transport });
    const traced = await adapter.trace({ merchantTrace: newMerchantTrace() });
    result = traced.authenticated ? 'authenticated' : 'unauthenticated';
  } catch (error) {
    if (error?.code === 'PAY05_PROVIDER_UNREACHABLE' || error?.code === 'PAY05_PROVIDER_HTTP_ERROR') throw new Pay05Error('PAY05_CONNECT_PROBE_UNAVAILABLE', 503);
    result = error?.code === 'PAY05_PROVIDER_TRACE_FAILED' ? 'refused' : 'unauthenticated';
  }
  if (result !== 'authenticated') {
    await db.rpc('pay05_record_provider_error', { p_kind: 'credential_probe_failed', p_tenant_id: tenantId, p_collection_id: null,
      p_merchant_account_id: null, p_detail: { stage: 'connect', currency: item.currency, result } });
    throw notAccepted();
  }
  return { result, credential_fingerprint: integrationKeyFingerprint(item.key) };
}

export async function connectGaragePaynow({ db = defaultDb, env = process.env, transport = null, actor = {}, body = {} } = {}) {
  requirePay05Enabled(env);
  const userId = actorId(actor);
  if (!actor.tenantId) throw new Pay05Error('PAY05_GARAGE_REQUIRED', 403);
  const mode = serverPaynowMode(env);
  const input = connectionInput(body);
  // the database re-checks authority; this refuses a person who may not connect before any key reaches Paynow
  await assertCanConnect(db, actor.tenantId, userId);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  // only this garage's own failed connections: an operator's verification probes failing is no reason to refuse its key (PFR-L12)
  const failures = list(await read(db.from('pay05_provider_errors').select('id, detail').eq('tenant_id', actor.tenantId)
    .eq('kind', 'credential_probe_failed').gte('created_at', since).limit(200))).filter((f) => f.detail?.stage === 'connect');
  if (failures.length >= CONNECT_PROBE_FAILURES_ALLOWED) throw notAccepted();
  const probes = [];
  for (const item of input.integrations) probes.push(await proveKeyAtConnect(db, env, transport, actor.tenantId, item, mode));
  const merchantAccountId = crypto.randomUUID();
  const integrations = input.integrations.map((item, index) => {
    const sealed = sealIntegrationKey(item.key, {
      aad: integrationKeyAad({ tenantId: actor.tenantId, merchantAccountId, currency: item.currency, integrationId: item.integrationId, mode }),
      env,
    });
    return { currency: item.currency, integration_id: item.integrationId, mode, methods: item.methods, ciphertext: sealed.ciphertext,
      iv: sealed.iv, tag: sealed.tag, key_version: sealed.keyVersion, fingerprint: sealed.fingerprint, probe: probes[index] };
  });
  const attestation = `${userId} confirms that the Paynow merchant account and the settlement account ending ${input.last4} belong to `
    + `${input.legal} and that they are authorised to connect them to CarUp for this garage.`;
  await rpc(db, 'pay05_register_paynow_merchant', {
    p_tenant_id: actor.tenantId, p_merchant_account_id: merchantAccountId, p_actor_id: userId, p_display_name: input.display,
    p_profile: { legal_entity_name: input.legal, registration_number: input.registration, settlement_bank_name: input.bank,
      settlement_account_last4: input.last4, settlement_account_holder: input.holder, attestation: attestation.slice(0, 600) },
    p_integrations: integrations,
  });
  return getGaragePaynowConnection({ db, env, actor });
}

export async function disconnectGaragePaynow({ db = defaultDb, env = process.env, actor = {}, body = {} } = {}) {
  const userId = actorId(actor);
  if (!actor.tenantId) throw new Pay05Error('PAY05_GARAGE_REQUIRED', 403);
  const reason = text(body.reason, { min: 10, max: 300 });
  if (!reason) throw new Pay05Error('PAY05_REASON_REQUIRED', 422);
  const account = (await read(db.from('pay04_garage_merchant_accounts').select('id, status').eq('tenant_id', actor.tenantId)
    .eq('gateway', PAY05_GATEWAY).in('status', ['pending_verification', 'verified']).order('registered_at', { ascending: false }).limit(1)))?.[0];
  if (!account) throw new Pay05Error('PAY05_MERCHANT_NOT_FOUND', 404);
  // this is the garage's own path: a garage administrator who is also a CarUp operator acts here as the garage
  await rpc(db, 'pay05_suspend_paynow_merchant', { p_merchant_account_id: account.id, p_actor_id: userId,
    p_actor_role: 'owner', p_reason: reason });
  return getGaragePaynowConnection({ db, env, actor });
}

// ───────────────────────────── the CarUp operator ─────────────────────────────

export async function listPaynowMerchants({ db = defaultDb, env = process.env } = {}) {
  requirePay05Enabled(env);
  const accounts = await read(db.from('pay04_garage_merchant_accounts').select('*').eq('gateway', PAY05_GATEWAY)
    .order('registered_at', { ascending: false }).limit(200));
  const tenantIds = [...new Set(list(accounts).map((a) => a.tenant_id))];
  const tenants = tenantIds.length ? await read(db.from('tenants').select('id, name').in('id', tenantIds)) : [];
  const names = new Map(list(tenants).map((t) => [t.id, t.name]));
  const merchants = [];
  for (const account of list(accounts)) merchants.push({ ...(await merchantBundle(db, account)), garage_name: names.get(account.tenant_id) ?? null });
  const order = { pending_verification: 0, verified: 1, suspended: 2, rejected: 3 };
  merchants.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  return { merchants, availability: await paynowAvailability(db) };
}

/** Open a stored integration key (inside this process only): AES-GCM authenticates it against its row's binding. */
function openRowKey(row, env) {
  return openIntegrationKey({ ciphertext: row.credential_ciphertext, iv: row.credential_iv, tag: row.credential_tag,
    keyVersion: row.credential_key_version }, {
    aad: integrationKeyAad({ tenantId: row.tenant_id, merchantAccountId: row.merchant_account_id, currency: row.currency,
      integrationId: row.integration_id, mode: row.mode }),
    env,
  });
}

function adapterWithKey(row, merchantAccount, key, { env, transport }) {
  return createPaynowAdapter({ integration: { integrationId: row.integration_id, key, currency: row.currency, methods: row.methods, mode: row.mode },
    merchantReference: merchantAccount.merchant_reference, env, transport });
}

/** Open a stored integration key (inside this process only) and build its adapter. */
export function adapterForIntegrationRow(row, merchantAccount, { env = process.env, transport = null } = {}) {
  return adapterWithKey(row, merchantAccount, openRowKey(row, env), { env, transport });
}

/**
 * Prove an integration's ID and key belong together WITHOUT creating a payment: trace a random merchant trace. Paynow
 * signs its NotFound reply with the integration key, so only the right key verifies it.
 */
export async function probeIntegration(db, env, row, merchantAccount, { transport = null } = {}) {
  const probedAt = new Date().toISOString();
  let result;
  let providerError = null;
  // the fingerprint is DERIVED from the key actually opened and proved, never copied from the row (independent review S9)
  let fingerprint = null;
  try {
    const key = openRowKey(row, env);
    fingerprint = integrationKeyFingerprint(key);
    const adapter = adapterWithKey(row, merchantAccount, key, { env, transport });
    const traced = await adapter.trace({ merchantTrace: newMerchantTrace() });
    result = traced.authenticated ? 'authenticated' : 'unauthenticated';
  } catch (error) {
    result = error?.code === 'PAY05_PROVIDER_RESPONSE_UNAUTHENTICATED' ? 'unauthenticated'
      : error?.code === 'PAY05_PROVIDER_TRACE_FAILED' ? 'refused'
        : error?.code === 'PAY05_PROVIDER_UNREACHABLE' || error?.code === 'PAY05_PROVIDER_HTTP_ERROR' ? 'unreachable' : 'unavailable';
    providerError = error?.details?.provider_error ?? error?.code ?? 'unknown';
  }
  if (result !== 'authenticated') {
    await db.rpc('pay05_record_provider_error', { p_kind: 'credential_probe_failed', p_tenant_id: row.tenant_id, p_collection_id: null,
      p_merchant_account_id: row.merchant_account_id, p_detail: { integration_row_id: row.id, currency: row.currency, result, provider_error: providerError } });
  }
  return { result, credential_fingerprint: fingerprint, probed_at: probedAt, provider_error: providerError };
}

async function paynowAccount(db, merchantAccountId) {
  const id = String(merchantAccountId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Pay05Error('PAY05_MERCHANT_NOT_FOUND', 404);
  const account = await read(db.from('pay04_garage_merchant_accounts').select('*').eq('id', id).maybeSingle());
  if (!account || account.gateway !== PAY05_GATEWAY) throw new Pay05Error('PAY05_MERCHANT_NOT_FOUND', 404);
  return account;
}

/**
 * Separation of duties, checked BEFORE any key is opened or Paynow is called (independent review S9). The database
 * re-checks all of it (pay05_assert_independent_reviewer): this only refuses earlier.
 */
async function assertIndependentReviewer(db, account, actor, userId) {
  if (!['admin', 'super_admin'].includes(actor.platformRole)) throw new Pay05Error('PAY05_VERIFICATION_AUTHORITY_REFUSED', 403);
  const [member, registrant] = await Promise.all([
    read(db.from('tenant_users').select('user_id').eq('tenant_id', account.tenant_id).eq('user_id', userId).limit(1)),
    read(db.from('pay05_merchant_integrations').select('id').eq('merchant_account_id', account.id).eq('registered_by', userId).limit(1)),
  ]);
  if (account.registered_by === userId || list(member).length || list(registrant).length) {
    throw new Pay05Error('PAY05_REVIEWER_SEPARATION_REQUIRED', 403);
  }
}

export async function verifyPaynowMerchant({ db = defaultDb, env = process.env, actor = {}, merchantAccountId, body = {}, transport = null } = {}) {
  requirePay05Enabled(env);
  const userId = actorId(actor);
  const account = await paynowAccount(db, merchantAccountId);
  await assertIndependentReviewer(db, account, actor, userId);
  const note = text(body.note, { min: 10, max: 300 });
  if (!note) throw new Pay05Error('PAY05_REASON_REQUIRED', 422);
  const pending = list(await read(db.from('pay05_merchant_integrations').select('*').eq('merchant_account_id', account.id)
    .eq('status', 'pending_verification')));
  const probes = {};
  for (const row of pending) probes[row.id] = await probeIntegration(db, env, row, account, { transport });
  // Paynow reports no currency: the operator reviews each integration's own settlement currency (independent review P3,
  // PAY-05-R1 ICR-P1); the database refuses a missing or different one
  const currencyEvidence = {};
  for (const row of pending) {
    const given = body.currency_evidence?.[row.id];
    if (given && typeof given === 'object') {
      currencyEvidence[row.id] = { settlement_currency: String(given.settlement_currency ?? ''), reference: String(given.reference ?? '').slice(0, 200),
        ...(given.fee_handling ? { fee_handling: String(given.fee_handling).slice(0, 60) } : {}) };
    }
  }
  const evidence = { legal_identity_reviewed: body.legal_identity_reviewed === true,
    settlement_account_reviewed: body.settlement_account_reviewed === true,
    currency_configuration_reviewed: body.currency_configuration_reviewed === true, credential_probes: probes,
    currency_evidence: currencyEvidence };
  try {
    await rpc(db, 'pay05_verify_paynow_merchant', { p_merchant_account_id: account.id, p_actor_id: userId,
      p_actor_role: actor.platformRole || null, p_evidence: evidence, p_note: note });
  } catch (error) {
    if (error.code === 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE') {
      throw new Pay05Error(error.code, 422, { probes: Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, v.result])) });
    }
    throw error;
  }
  return { merchant: await merchantBundle(db, await paynowAccount(db, account.id)), probes };
}

export async function rejectPaynowMerchant({ db = defaultDb, env = process.env, actor = {}, merchantAccountId, body = {} } = {}) {
  requirePay05Enabled(env);
  const account = await paynowAccount(db, merchantAccountId);
  await rpc(db, 'pay05_reject_paynow_merchant', { p_merchant_account_id: account.id, p_actor_id: actorId(actor),
    p_actor_role: actor.platformRole || null, p_reason: String(body.reason ?? '') });
  return { merchant: await merchantBundle(db, await paynowAccount(db, account.id)) };
}

export async function suspendPaynowMerchant({ db = defaultDb, env = process.env, actor = {}, merchantAccountId, body = {} } = {}) {
  requirePay05Enabled(env);
  const account = await paynowAccount(db, merchantAccountId);
  await rpc(db, 'pay05_suspend_paynow_merchant', { p_merchant_account_id: account.id, p_actor_id: actorId(actor),
    p_actor_role: actor.platformRole || null, p_reason: String(body.reason ?? '') });
  return { merchant: await merchantBundle(db, await paynowAccount(db, account.id)) };
}

export async function getPaynowAvailability({ db = defaultDb, env = process.env } = {}) {
  requirePay05Enabled(env);
  return paynowAvailability(db);
}

export async function setPaynowAvailability({ db = defaultDb, env = process.env, actor = {}, body = {} } = {}) {
  requirePay05Enabled(env);
  if (typeof body.available !== 'boolean') throw new Pay05Error('PAY05_AVAILABILITY_INVALID', 422);
  await rpc(db, 'pay05_set_paynow_availability', { p_available: body.available, p_actor_id: actorId(actor),
    p_actor_role: actor.platformRole || null, p_note: String(body.note ?? '') });
  return paynowAvailability(db);
}

export async function listPaynowProviderErrors({ db = defaultDb, env = process.env } = {}) {
  requirePay05Enabled(env);
  const rows = await read(db.from('pay05_provider_errors').select('id, seq, tenant_id, collection_id, merchant_account_id, kind, detail, created_at')
    .order('seq', { ascending: false }).limit(100));
  return { errors: list(rows) };
}
