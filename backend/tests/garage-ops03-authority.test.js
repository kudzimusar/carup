
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGmoDatabase } from './helpers/gmoGarageWorld.js';
import { migrationUpSql, supabaseOver } from './helpers/pgliteLedgerHarness.js';
import {
  addWorkforceRecurringSchedule,
  addWorkforceUnavailability,
  getGarageSchedule,
  getGarageSchedulingConfiguration,
  getRequesterAppointmentAvailability,
  requestAppointment,
  transitionGarageAppointment,
  cancelRequesterAppointment,
  updateBranchSchedulingSettings,
} from '../services/garageOperations/garageSchedulingService.js';

let db;
let client;
const T = {};
const B = {};
const P = {};
const C = {};
const actor = (id, tenantId, tenantRole = 'admin') => ({
  id,
  role: 'owner',
  activeTenant: { id: tenantId, type: 'garage', role: tenantRole },
});
const requester = (id) => ({ id, role: 'owner', activeTenant: null });

before(async () => {
  db = await createGmoDatabase();
  for (const file of [
    '20261004180000_service_network_s1_garage_identity.sql',
    '20261004180100_service_network_s2_service_cases.sql',
    '009_phase4_schema.sql',
    '20261004180300_service_network_s4_work_order_assignment.sql',
    '20261004180400_service_network_s5_service_records.sql',
    '20261022130000_garage_ops01_multisite_workforce.sql',
    '20261023140000_garage_ops03_appointments_scheduling_capacity.sql',
  ]) await db.exec(migrationUpSql(file));

  for (const id of ['admin-a','admin-b','mech-a','customer-a','customer-b']) {
   ¶»§q«^