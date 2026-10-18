/**
 * CA-OWNER-02 (E) — Platform / Security runtime facts for an authenticated Corporate principal (platform.health.read).
 *
 * Each fact comes from the runtime's OWN authority — the same helpers /api/health uses — and keeps its own state: there is
 * no platform "health score". What may leave this module is the safe subset only: build identity, database project refs
 * and consistency, session-authority + TLS posture, scheduler and kill-switch state, provider readiness (channel, provider,
 * status) and backlog counts. Never: secrets, connection strings, variable values, free-text provider or cron errors,
 * webhook URLs, the in-process metrics map, or the database role name.
 *
 * Environment is taken from the API host this request reached: the staging project's Vercel production target reports
 * itself as "production", which would mislead.
 */
import { supabase as defaultClient } from '../../../db/supabase.js';
import { resolveBuildProvenance } from '../../../config/buildProvenance.js';
import { resolveDatabaseTarget } from '../../../config/databaseTarget.js';
import { validateCommunicationConfiguration } from '../../communication/communicationConfigurationValidator.js';
import { outboundHealth } from '../../communication/outboundKillSwitch.js';
import { probeSessionAuthorityConnection } from '../../auth/sessionAuthority.js';
import { countUnrecordedLedgerIntents } from '../../blockchain/ledgerIntentService.js';
import { readFact, statementFact, CURRENT_WINDOW } from './managementFact.js';
import { exactCount } from './sourceReads.js';
import { createBoundedSource, BoundedSourcePending } from './boundedSource.js';
import { runtimeKeepAlive } from './managementSnapshotCache.js';

const SCOPE = 'Staging runtime · this API deployment';

/**
 * CA-OWNER-02-R3 (D3) — get_communication_scheduler_health() scans the full cron run history (cron.job_run_details: about
 * 179,000 rows, 264 MB on staging) three times per call. The database function cannot change in this lane, so its cost is
 * bounded here: it is read at most every 5 minutes, a page waits for it at most 2.5 s, a slow read finishes in the
 * background (kept alive by the runtime past the response), and a cached reading is served — with the time it was really
 * read — for at most 30 minutes.
 */
export const SCHEDULER_HEALTH_LIMITATION = 'get_communication_scheduler_health() scans the full cron run history on every call — a known database limitation';
export function createSchedulerHealthRead(client, { ttlMs = 300_000, budgetMs = 2_500, maxAgeMs = 1_800_000, now, keepAlive } = {}) {
  const source = createBoundedSource(async () => {
    const { data, error } = await client.rpc('get_communication_scheduler_health');
    if (error) throw new Error('scheduler health unavailable');
    return data;
  }, { ttlMs, budgetMs, maxAgeMs, ...(now ? { now } : {}), ...(keepAlive ? { keepAlive } : {}) });
  return async () => {
    try {
      const { value, readAt, refreshing } = await source.get();
      return { data: value, readAt, refreshing };
    } catch (err) {
      if (err instanceof BoundedSourcePending) {
        throw Object.assign(new Error('scheduler health pending'), {
          factReason: `The scheduler-health read is still running, so no value is shown yet: ${SCHEDULER_HEALTH_LIMITATION}.`,
        });
      }
      throw new Error('scheduler health unavailable');
    }
  };
}
const schedulerReads = new WeakMap();
const schedulerReadFor = (client) => {
  if (!schedulerReads.has(client)) schedulerReads.set(client, createSchedulerHealthRead(client, { keepAlive: runtimeKeepAlive }));
  return schedulerReads.get(client);
};

/** The runtime authorities, injectable for tests. */
export function defaultRuntime(client = defaultClient, env = process.env) {
  return {
    /** The bounded scheduler-health read (one per client, shared by every snapshot this process computes). */
    schedulerHealthRead: schedulerReadFor(client),
    build: () => resolveBuildProvenance(),
    databaseTarget: () => resolveDatabaseTarget(env),
    communicationConfiguration: () => validateCommunicationConfiguration(),
    outbound: () => outboundHealth(env),
    probeSessionAuthority: () => probeSessionAuthorityConnection(),
    ledgerIntentBacklog: () => countUnrecordedLedgerIntents(),
    outboxBacklog: () => exactCount(client, 'domain_events', { column: '*', shape: (q) => q.eq('status', 'pending') }),
    async schedulerHealth() {
      const { data, error } = await client.rpc('get_communication_scheduler_health');
      if (error) throw new Error('scheduler health unavailable');
      return data;
    },
  };
}

/** The environment as the API host names it. */
export function environmentFromHost(host) {
  const h = String(host || '').toLowerCase().split(':')[0];
  if (!h) return 'unrecognised';
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost')) return 'local';
  if (/(^|\.)api-staging\.carup\.dev$/.test(h) || /^carup-backend-staging(-[a-z0-9-]+)?\.vercel\.app$/.test(h)) return 'staging';
  return 'unrecognised';
}

const yes = (b) => (b ? 'yes' : 'no');

export async function readPlatformFacts({ now = new Date(), host = null, runtime = defaultRuntime() } = {}) {
  const spec = (id, label, extra = {}) => ({ id, label, kind: 'technical', source: { authority: extra.authority ?? 'runtime' }, asOf: now, scope: SCOPE, window: CURRENT_WINDOW, ...extra });
  const run = (s, reader, timeoutMs) => readFact(s, reader, { now, ...(timeoutMs ? { timeoutMs } : {}) });

  let configuration = null;
  try { configuration = runtime.communicationConfiguration(); } catch { configuration = null; }
  const providers = Array.isArray(configuration?.providers)
    ? configuration.providers.map((p) => ({ channel: p.channel, provider: p.provider, status: p.status, available: p.available === true }))
    : null;

  const facts = await Promise.all([
    run(spec('platform.build.commit', 'Build identity (commit)', { authority: 'build provenance (deployment environment)' }), async () => {
      const b = runtime.build();
      if (!b?.commit_sha || b.source === 'conflict') return { complete: false, detail: 'The deployment reports no single build identity.' };
      return { value: b.commit_sha_short || b.commit_sha.slice(0, 8), detail: `Commit ${b.commit_sha} · branch ${b.branch ?? 'unknown'} · deployment ${b.deployment_id ?? 'unknown'} · source ${b.source}` };
    }),
    run(spec('platform.environment', 'Environment', { authority: 'API host of this request' }), async () => ({
      value: environmentFromHost(host),
      detail: `Answered by ${String(host || 'an unnamed host')}. The Vercel target label is not used: the staging project's production target calls itself "production".`,
    })),
    run(spec('platform.database.consistency', 'Database target consistency', { authority: 'database target (configured endpoints)' }), async () => {
      const d = runtime.databaseTarget();
      const refs = Array.isArray(d?.postgres_project_refs) ? d.postgres_project_refs : [];
      return {
        value: d?.consistent === true ? 'consistent' : 'inconsistent',
        detail: `Supabase project ${d?.supabase_project_ref ?? 'unknown'} · database endpoints name ${refs.length ? [...new Set(refs)].join(', ') : 'no project'} · ${Number(d?.unrecognised_endpoints || 0)} unrecognised. The session-authority database is not part of this check.`,
      };
    }),
    run(spec('platform.api.database_reachable', 'API → database reachability', { authority: 'domain_events read' }), async () => {
      await runtime.outboxBacklog();
      return { value: 'reachable', detail: 'This API deployment read the database while answering.' };
    }),
    run(spec('platform.session_authority', 'Session authority and TLS', { authority: 'session-authority connection probe' }), async () => {
      const p = await runtime.probeSessionAuthority();
      const healthy = p?.connected === true && p?.client_tls === true && p?.client_tls_authorized === true;
      return {
        value: healthy ? 'healthy' : 'unhealthy',
        detail: `Connected: ${yes(p?.connected === true)} · TLS: ${yes(p?.client_tls === true)} · peer certificate authorized: ${yes(p?.client_tls_authorized === true)} · database backend TLS: ${yes(p?.postgres_backend_tls === true)} · verification ${p?.verification ?? 'unknown'} against ${p?.trust_anchor ?? 'unknown trust anchor'}.`,
      };
    }, 6_000),
    Promise.resolve(statementFact({
      id: 'platform.certification_sessions',
      label: 'Active certification sessions',
      state: 'UNAVAILABLE_NO_SOURCE',
      reason: 'No aggregate session read exists. AUTH-05 closed user_sessions to the service role, and adding a session count would change the frozen session authority — an Owner decision.',
      scope: SCOPE,
    })),
    run(spec('platform.communications.scheduler', 'Communication scheduler', { authority: 'get_communication_scheduler_health()' }), async () => {
      // CA-OWNER-02-R3 (D3): through the bounded read when the runtime has one (it reports when it was REALLY read).
      const bounded = typeof runtime.schedulerHealthRead === 'function' ? await runtime.schedulerHealthRead() : null;
      const h = bounded ? bounded.data : await runtime.schedulerHealth();
      const cadence = bounded
        ? ` Read at most every 5 minutes because ${SCHEDULER_HEALTH_LIMITATION}${bounded.refreshing ? '; a newer reading is being taken' : ''}.`
        : '';
      if (!h || h.pg_cron_available !== true) return { value: 'scheduler unavailable', detail: `pg_cron is not available to this database.${cadence}`, asOf: bounded?.readAt };
      const active = h.job_config?.active === true;
      const parts = [
        `job ${h.job_config?.jobname ?? 'unknown'} (${h.job_config?.schedule ?? 'no schedule'})`,
        h.latest_run ? `last run ${h.latest_run.status ?? 'unknown'} at ${h.latest_run.start_time ?? 'unknown'}` : 'no run recorded',
        h.latest_success?.start_time ? `last success ${h.latest_success.start_time}` : 'no success recorded',
        `stale locks ${Number(h.stale_lock_count || 0)}`,
      ];
      return {
        value: active ? 'worker job active' : 'worker job inactive',
        detail: `${parts.join(' · ')}. A cron "succeeded" run is not proof that its HTTP call succeeded.${cadence}`,
        asOf: bounded?.readAt,
      };
    }),
    run(spec('platform.communications.kill_switch', 'Outbound kill switch', { authority: 'COMMUNICATION_OUTBOUND_DISABLED' }), async () => {
      const o = runtime.outbound();
      return { value: `${o?.kill_switch ?? 'unknown'} — external sends ${o?.external_sends ?? 'unknown'}`, detail: `Internal channels ${o?.internal_channels ?? 'unknown'}. Changing it is a governed platform action, not available here.` };
    }),
    run(spec('platform.providers.ready', 'Delivery channels ready', { authority: 'communication configuration validator' }), async () => {
      if (!providers) return { complete: false };
      const ready = providers.filter((p) => p.available).map((p) => p.channel);
      const notReady = providers.filter((p) => !p.available).map((p) => `${p.channel} (${String(p.status).toLowerCase()})`);
      return { value: ready.length, detail: `Ready: ${ready.join(', ') || 'none'}. Not ready: ${notReady.join(', ') || 'none'}. Configured is not the same as healthy or used.` };
    }),
    run(spec('platform.outbox.backlog', 'Event outbox backlog', { authority: 'domain_events (status pending)' }), async () => ({
      value: await runtime.outboxBacklog(), detail: 'Pending domain events, including ones whose attempts are exhausted; dead-lettered events are not included.',
    })),
    run(spec('platform.ledger_intent.backlog', 'Ledger intent backlog', { authority: 'ledger_event_intents (not yet recorded)' }), async () => {
      const n = await runtime.ledgerIntentBacklog();
      if (typeof n !== 'number' || !Number.isFinite(n)) return { complete: false };
      return { value: n };
    }),
  ]);
  return { facts, providers };
}
