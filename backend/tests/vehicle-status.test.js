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
  // Reserved vehicles are mid-transaction: per mainline semantics they do
  // not count as restored to the public marketplace.
  assert.equal(isVehicleRestoredToMarketplaceStatus('reserved'), false);
  assert.equal(isVehicleRestoredToMarketplaceStatus('Suspended'), false);
  assert.equal(isPublicVehicleStatus('Suspended'), false);
});
