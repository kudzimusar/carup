
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createGmoDatabase } from './helpers/gmoGarageWorld.js';
import { migrationUpSql, MIGRATIONS_DIR } from './helpers/pgliteLedgerHarness.js';

const OPS02 = '20261023111516_garage_ops02_customer_vehicle_relationship.sql';
const OPS03 = '20261023140000_garage_ops03_appointments_scheduling_capacity.sql';
const SLOT_START = '2026-10-26T08:00:00.000Z'; // 10:00 Africa/Harare.
const SLOT_END = '2026-10-26T09:00:00.000Z';
let db;
const T = {};
const B = {};
const P = {};
const C = {};

async function rejected(promise) {
  try { await promise; return null; } catch (error) { return error; }
}

async function forceAuditFailure(eventType) {
  const allowed = new Set([
    'GARAGE_BRANCH_SCHEDULING_UPDATED',
    'GARAGE_WORKFORCE_SCHEDULE_UPDATED',
    'GARAGE_WORKFORCE_UNAVAILABILITY_CHANGED',
  ]);
  if (!allowed.has(eventType)) throw new Error('unexpected test audit event');
  await db.exec('DROP TRIGGER IF EXISTS trg_ops03_test_fail_audit ON trust_audit_events');
  await db.exec('DROP FUNCTION IF EXISTS garage_ops03_test_fail_audit()');
  await db.exec(
    "CREATE FUNCTION garage_ops03_test_fail_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN " +
    "IF NEW.event_type = '" + eventType + "' THEN RAISE EXCEPTION 'OPS03_TEST_AUDIT_FAILURE'; END IF; " +
    "RETURN NEW; END $$; " +
    "CREATE TRIGGER trg_ops03_test¶»§q«^