import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../database/migrations/20260705190000_communication_privilege_hardening.sql', import.meta.url),
  'utf8',
);

const phrase = (...parts) => parts.join(' ');

test('privilege hardening resets direct authenticated access before read grants', () => {
  assert.ok(sql.includes(phrase('REVOKE', 'ALL', 'ON', 'communication_audit_events', 'FROM', 'authenticated;')));
  assert.ok(sql.includes(phrase('GRANT', 'SELECT', 'ON', 'communication_audit_events', 'TO', 'authenticated;')));
  assert.ok(sql.includes(phrase('REVOKE', 'ALL', 'ON', 'communication_sla_policies', 'FROM', 'authenticated;')));
  assert.ok(sql.includes(phrase('GRANT', 'SELECT', 'ON', 'communication_sla_policies', 'TO', 'authenticated;')));
});