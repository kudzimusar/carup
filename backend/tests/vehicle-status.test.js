import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPublicVehicleStatus,
  isVehicleQuarantinedStatus,
  isVehicleRestoredToMarketplaceStatus,
  normalizeVehicleStatus,
} from '../utils/vehicleStatus.js';

test('normalizes marketplace and quarantine vehicle statuses', () => {
  assert.equal(normalizeVehicleStatus('active'), 'Available');
  assert.equal(normalizeVehicleStatus('suspended'), 'Suspended');
  assert.equal(normalizeVehicleStatus('flagged'), 'Flagged');
  assert.equal(normalizeVehicleStatus('banned'), 'Banned');
});

test('identifies quarantined vehicle statuses', () => {
  assert.equal(isVehicleQuarantinedStatus('Suspended'), true);
  assert.equal(isVehicleQuarantinedStatus('flagged'), true);
  assert.equal(isVehicleQuarantinedStatus('banned'), true);
  assert.equal(isVehicleQuarantinedStatus('Available'), false);
});

test('identifies marketplace restoration statuses without broadening public filtering', () => {
  assert.equal(isVehicleRestoredToMarketplaceStatus('Available'), true);
  assert.equal(isVehicleRestoredToMarketplaceStatus('reserved'), true);
  assert.equal(isVehicleRestoredToMarketplaceStatus('Suspended'), false);
  assert.equal(isPublicVehicleStatus('Suspended'), false);
});
