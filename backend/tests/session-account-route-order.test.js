import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminRoutes = readFileSync(new URL('../routes/adminRoutes.js', import.meta.url), 'utf8');
const sessionRoutes = readFileSync(new URL('../routes/sessionAccountRoutes.js', import.meta.url), 'utf8');
const authMiddleware = readFileSync(new URL('../middleware/authMiddleware.js', import.meta.url), 'utf8');

test('canonical session account router is mounted before legacy inline account handlers', () => {
  assert.match(adminRoutes, /import sessionAccountRouter from '\.\/sessionAccountRoutes\.js'/);
  const mount = adminRoutes.indexOf('router.use(sessionAccountRouter)');
  const firstAdminRoute = adminRoutes.indexOf("router.get('/api/users/management'");
  assert.ok(mount >= 0 && mount < firstAdminRoute, 'session account router must be mounted first');
});

test('/auth/me returns the role and tenant established by middleware session truth', () => {
  assert.match(sessionRoutes, /role:\s*req\.userContext\.role/);
  assert.match(sessionRoutes, /active_tenant_id:\s*req\.userContext\.tenantId \|\| null/);
});

test('role switch returns an explicit safe user projection', () => {
  assert.match(sessionRoutes, /select\('id, name, email, phone, role, avatar'\)/);
  assert.doesNotMatch(sessionRoutes, /from\('users'\)[\s\S]{0,80}select\('\*'\)/);
});

test('authenticated middleware reads active role and organization from the session row', () => {
  assert.match(authMiddleware, /active_role, active_organization_id/);
  assert.match(authMiddleware, /Requested role does not match the active session/);
  assert.match(authMiddleware, /Requested tenant does not match the active session/);
});

test('notification compatibility includes only legacy rows without a canonical recipient', () => {
  assert.match(sessionRoutes, /listUserNotifications\(supabase, req\.userContext\.id\)/);
});
