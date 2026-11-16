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

test('SN-0: no authorization path consults a registration business_type claim', () => {
  // `business_type` is an APPLICATION, recorded so a human review has something to review. If an
  // authorization decision ever read it, anyone could self-declare into a garage.
  //
  // The check is deliberately structural rather than file-level: server.js is a monolith holding
  // both the registration endpoint (which legitimately echoes the claim back) and every route, so
  // "this file mentions both" proves nothing. What matters is WHERE the claim may appear.

  // 1. The layers that decide access may not mention it at all.
  const DECIDING_DIRS = ['middleware', 'routes', 'services/serviceNetwork', 'services/featureGovernance'];
  const offenders = [];
  for (const file of SOURCES) {
    const rel = file.replace(ROOT, '');
    if (!DECIDING_DIRS.some((d) => rel.startsWith(d))) continue;
    if (readFileSync(file, 'utf8').includes('business_type')) offenders.push(rel);
  }
  assert.deepEqual(offenders, [],
    `these access-deciding modules mention a self-declared business_type:\n${offenders.join('\n')}`);

  // 2. Everywhere else it may be stored or echoed, but never branched on.
  for (const file of SOURCES) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('business_type')) return;
      assert.ok(!/\b(if|switch|case|\?|&&|\|\|)\b/.test(line) || line.trim().startsWith('*') || line.trim().startsWith('//'),
        `${file.replace(ROOT, '')}:${i + 1} branches on a self-declared business_type: ${line.trim()}`);
      assert.ok(!/authorize|allowedRoles|effectiveRole|requireTenant/.test(line),
        `${file.replace(ROOT, '')}:${i + 1} mixes business_type with an authorization decision`);
    });
  }
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
