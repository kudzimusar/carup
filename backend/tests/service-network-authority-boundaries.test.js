/**
 * SN-0 — the boundaries Service Network stands on.
 *
 * Service Network decides what an AUTHORIZED actor may do inside a service workflow. It does not
 * decide who is authorized. That comes from identity, governed onboarding and tenant membership,
 * and this file pins the boundary between them from the Service Network side.
 *
 * Three claims, each of which would be a privilege escalation if it were ever false:
 *
 *   1. A registration/profile CLAIM ("I am a garage", "I am a mechanic") grants nothing.
 *   2. OCR / document extraction grants nothing.
 *   3. A scanned QR / Service Link grants nothing.
 *
 * These are source-and-behaviour tests rather than stub tests, because a stub answers whatever it is
 * asked: the question here is whether any authorization path CONSULTS these inputs at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const ROOT = new URL('../', import.meta.url).pathname;

/** Every backend source file, excluding tests. */
function backendSources(dir = ROOT, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'tests', '.git'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) backendSources(full, acc);
    else if (entry.endsWith('.js')) acc.push(full);
  }
  return acc;
}

const SOURCES = backendSources();

test('SN-0: a registration claim may open your OWN application, and nothing more', () => {
  // `business_type` is an APPLICATION. Reconciled with O2 (PR #208), the real invariant is finer
  // than "never mentioned in an access path":
  //
  //   A claim MAY gate access to the applicant's own onboarding surfaces — "you said you are a
  //   dealer, so you may work on your dealer application". O2's `assertDealerOnboardingContext`
  //   does exactly this and says so: "onboarding capability only, never Dealer authority".
  //
  //   A claim may NEVER grant a professional capability, a tenant, a membership or a domain
  //   authority. That is the escalation this file exists to prevent.
  //
  // So the test asks what a claim-reading module DOES, not merely whether it reads one.

  const offenders = [];
  for (const file of SOURCES) {
    const rel = file.replace(ROOT, '');
    const text = readFileSync(file, 'utf8');
    if (!text.includes('business_type')) continue;

    // 1. A claim-reader must never WRITE tenancy or a platform role. Reading `tenant_users` is
    //    ordinary and everywhere (server.js selects it in six places); creating a membership is
    //    the escalation. File-level co-occurrence proves nothing in a 4,000-line monolith, so the
    //    check is on the mutation, not the mention.
    const tenancyWrites = text.match(/from\('(tenant_users|tenants)'\)[\s\S]{0,140}?\.(insert|update|upsert|delete)\(/g);
    if (tenancyWrites) {
      offenders.push(`${rel}: reads business_type AND writes tenancy — ${tenancyWrites.join(' | ')}`);
    }

    // 2. A claim must never reach a Service Network / domain-capability decision.
    if (rel.startsWith('services/serviceNetwork') || rel.startsWith('services/featureGovernance')) {
      offenders.push(`${rel}: a domain-capability module must not consult a self-declared claim`);
    }

    // 3. Wherever it is branched on, the refusal must be scoped to onboarding — never to a
    //    professional capability. A module that both branches on the claim and mentions
    //    GARAGE_ROLES / capability grants is conflating application access with authority.
    if (/business_type\s*!==?|business_type\s*===?/.test(text) && /GARAGE_ROLES|grantCapability|activateTenant/.test(text)) {
      offenders.push(`${rel}: branches on a claim in a module that also grants capability`);
    }
  }
  assert.deepEqual(offenders, [],
    `a self-declared claim is being treated as authority:\n${offenders.join('\n')}`);
});

test('SN-0: the dealer-onboarding claim gate grants onboarding access ONLY', () => {
  // Pinning the reconciled O2 boundary directly, so a future edit that widens it is caught here
  // rather than in production.
  const svc = readFileSync(join(ROOT, 'services/dealer/dealerOnboardingService.js'), 'utf8');
  for (const forbidden of ['tenant_users', "from('tenants')", 'active_tenant_role']) {
    assert.ok(!svc.includes(forbidden),
      `dealerOnboardingService must not touch ${forbidden} — a claim opens an application, not a business`);
  }
  // And it must still fail closed for someone who never declared a dealer business.
  assert.match(svc, /account_kind !== 'business'/);
  assert.match(svc, /DEALER_ONBOARDING_CONTEXT_REQUIRED/);
});

test('SN-0: the registration profile module grants no role, tenant or membership', () => {
  const text = readFileSync(join(ROOT, 'services/auth/registrationProfileService.js'), 'utf8');
  for (const forbidden of ['tenant_users', "from('tenants')", 'active_tenant', 'authorizeRole', 'users\').update']) {
    assert.ok(!text.includes(forbidden),
      `registrationProfileService must never touch ${forbidden} — a stated intent is not an authority`);
  }
  // And the vocabulary it accepts is a closed list, so a claim cannot be an arbitrary string.
  assert.match(text, /REGISTRATION_BUSINESS_TYPES = Object\.freeze/);
});

test('SN-0: identity verification and document extraction grant no role, tenant or membership', () => {
  // OCR is INPUT ASSISTANCE. It may produce candidate fields with provenance; it may never produce
  // authority. If an identity/OCR module ever wrote a membership, a forged document would become a
  // garage.
  const identityDir = join(ROOT, 'services/identity');
  const offenders = [];
  for (const entry of readdirSync(identityDir)) {
    if (!entry.endsWith('.js')) continue;
    const text = readFileSync(join(identityDir, entry), 'utf8');
    for (const forbidden of ['tenant_users', "from('tenants')", "from('users').update", 'active_tenant_role']) {
      if (text.includes(forbidden)) offenders.push(`${entry} -> ${forbidden}`);
    }
  }
  assert.deepEqual(offenders, [],
    `identity/OCR modules must never write authority:\n${offenders.join('\n')}`);
});

test('SN-0: Service Network reads authority, and never writes a membership', () => {
  // The Service Network services may READ tenant membership to scope themselves. If one of them
  // ever INSERTED a membership, the workflow would be minting its own operators.
  const snDir = join(ROOT, 'services/serviceNetwork');
  const offenders = [];
  for (const entry of readdirSync(snDir)) {
    if (!entry.endsWith('.js')) continue;
    const text = readFileSync(join(snDir, entry), 'utf8');
    // An insert/update/upsert anywhere in the same statement chain as tenant_users or tenants.
    const writes = text.match(/from\('(tenant_users|tenants)'\)[\s\S]{0,120}?\.(insert|update|upsert|delete)\(/g);
    if (writes) offenders.push(`${entry}: ${writes.join(' | ')}`);
  }
  assert.deepEqual(offenders, [],
    `Service Network must consume membership, never create it:\n${offenders.join('\n')}`);
});

test('SN-0: resolving a scanned link grants nothing — it reports, it does not write', () => {
  const text = readFileSync(join(ROOT, 'services/serviceNetwork/serviceLinkService.js'), 'utf8');
  const resolver = text.slice(
    text.indexOf('export async function resolveServiceLink'),
    text.indexOf('export async function grantCapability'),
  );
  assert.ok(resolver.length > 200, 'the resolver body must be found');
  for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(']) {
    assert.ok(!resolver.includes(forbidden),
      `resolveServiceLink must not ${forbidden} — a scan is a read, and a QR code confers no authority`);
  }
});

test('SN-0: the ONLY roles a garage route accepts are the governed ones', () => {
  // A drift here is how a profile claim or a self-assigned role would become garage access.
  const routeFiles = ['garageQueueRoutes.js', 'serviceCaseRoutes.js', 'serviceWorkOrderRoutes.js', 'serviceRecordRoutes.js', 'garageDirectoryRoutes.js'];
  for (const file of routeFiles) {
    const text = readFileSync(join(ROOT, 'routes', file), 'utf8');
    const decl = text.match(/const GARAGE_ROLES = \[([^\]]*)\]/);
    if (!decl) continue;
    const roles = decl[1].split(',').map((r) => r.trim().replace(/['"]/g, '')).filter(Boolean);
    assert.deepEqual(roles, ['mechanic', 'dealer', 'admin'],
      `${file} declares an unexpected GARAGE_ROLES set: ${roles.join(', ')}`);
  }
});

/**
 * GMO — the COMPLETE set of product paths that may create a garage membership.
 *
 * The existing invariants above are scoped to `services/identity` and `services/serviceNetwork`, so
 * a new service elsewhere could mint memberships and every suite would stay green. That gap was
 * found by an adversarial review, and it matters more than it used to: the garage-side route gate
 * now consults `tenant_users.role` directly (`authorizeTenantRole`), so whoever can write that table
 * can hand out route access.
 *
 * Two paths are authorised, and they are named here rather than described:
 *
 *   1. `activate_garage_application` — the PostgreSQL function, called only after a governed
 *      Operations approval. It creates the FOUNDING admin.
 *   2. `garageInvitationService.acceptInvitation` — a person redeeming a single-use, expiring,
 *      email-bound invitation issued by that garage's own admin.
 *
 * Anything else appearing in this list is a new way to become an operator, and must be a deliberate
 * decision rather than a diff nobody noticed.
 */
test('GMO-0: only the two governed paths CREATE a garage membership', () => {
  const servicesDir = join(ROOT, 'services');
  const offenders = [];
  const walk = (dir, rel = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(abs, path); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const text = readFileSync(abs, 'utf8');
      // Creating is the dangerous verb: it GRANTS authority where there was none.
      const creates = text.match(/from\('tenant_users'\)[\s\S]{0,140}?\.(insert|upsert)\(/g);
      if (creates) offenders.push(path);
    }
  };
  walk(servicesDir);

  assert.deepEqual(offenders.sort(), ['garageOnboarding/garageInvitationService.js'],
    `Only invitation acceptance may create a membership from application code (the founding admin comes from the database function). Found:\n${offenders.join('\n')}`);
});

/**
 * Ending or changing a membership is a different verb from creating one, and a different risk.
 * Removing someone cannot grant anything; promoting them to `admin` can, which is why the same
 * enumeration covers both and why `garageMembershipService` is named here deliberately.
 */
test('GMO-0: only the membership service ENDS or CHANGES a garage membership', () => {
  const servicesDir = join(ROOT, 'services');
  const offenders = [];
  const walk = (dir, rel = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(abs, path); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const text = readFileSync(abs, 'utf8');
      const mutates = text.match(/from\('tenant_users'\)[\s\S]{0,140}?\.(update|delete)\(/g);
      if (mutates) offenders.push(path);
    }
  };
  walk(servicesDir);

  assert.deepEqual(offenders.sort(), ['garageOnboarding/garageMembershipService.js'],
    `Only the membership service may end or change a membership. Found:\n${offenders.join('\n')}`);
});

test('GMO-0: removing a member touches no record of work already done', () => {
  const service = readFileSync(join(ROOT, 'services/garageOnboarding/garageMembershipService.js'), 'utf8');
  // A garage that could erase who serviced a car by removing a mechanic would be a garage whose
  // service history means nothing. The vehicle's record belongs to the vehicle.
  for (const table of ['work_order_assignments', 'service_records', 'service_cases', 'service_work_orders']) {
    assert.ok(!new RegExp(`from\\('${table}'\\)`).test(service),
      `revocation must never touch ${table}`);
  }
});

test('GMO-0: an invitation cannot mint a role outside the garage vocabulary', () => {
  const service = readFileSync(join(ROOT, 'services/garageOnboarding/garageInvitationService.js'), 'utf8');
  // The role written to `tenant_users` comes from the invitation row, and the invitation's role is
  // constrained both here and by a database CHECK. A garage admin must not be able to invite
  // someone as a role that satisfies a route their own garage does not own.
  assert.match(service, /export const INVITABLE_ROLES = Object\.freeze\(\['mechanic', 'admin'\]\)/);
  assert.match(service, /role: invitation\.role/,
    'the membership role comes from the invitation row, never from the request');

  const migration = readFileSync(
    join(ROOT, '../database/migrations/20260906180000_garage_invitations.sql'), 'utf8');
  assert.match(migration, /role TEXT NOT NULL CHECK \(role IN \('mechanic', 'admin'\)\)/,
    'the database constrains the invitable roles too');
});

test('GMO-0: only garage-side, tenant-scoped routers accept a tenant role at the gate', () => {
  const routesDir = join(ROOT, 'routes');
  const optedIn = readdirSync(routesDir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /authorizeTenantRole\(/.test(readFileSync(join(routesDir, f), 'utf8')))
    .sort();
  // `tenant_users.role` and `users.role` are different namespaces that share spellings. A route
  // whose 'admin' means CarUp administrator must never appear here.
  assert.deepEqual(optedIn, [
    'garageDirectoryRoutes.js',
    'garageInvitationRoutes.js',
    'garageMembershipRoutes.js',
    'garageQueueRoutes.js',
    'serviceCaseRoutes.js',
    'serviceRecordRoutes.js',
    'serviceWorkOrderRoutes.js',
  ]);
});
