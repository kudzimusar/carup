export const REL03B5_STAGING_PROJECT_REF = 'eoyenigwevnxwwhyhaer';
export const REL03B5_SOURCE_CONVERGENCE_SHA = '7e1bb39598d5ccc787b614135e19f217b038a8ee';
export const REL03B5_EXPECTED_TOTAL = 196;
export const REL03B5_EXPECTED_FINGERPRINT = '5f95aa1324364a05d10654ae4c7ce195';

export const REL03B5_REASON = Object.freeze({
  AUDIT_ONLY_LEGACY: 'AUDIT_ONLY_LEGACY',
  LEGACY_DUPLICATE_WORKFLOW_EVENT: 'LEGACY_DUPLICATE_WORKFLOW_EVENT',
  LEGACY_DUPLICATE_DIRECT_NOTIFICATION: 'LEGACY_DUPLICATE_DIRECT_NOTIFICATION',
  RETIRED_HISTORICAL_EVENT: 'RETIRED_HISTORICAL_EVENT',
});

export const REL03B5_FAMILY_COUNTS = Object.freeze({
  'dealer.onboarding.started': 6,
  DIASPORA_CONTAINER_LOADING: 4,
  DIASPORA_SHIPMENT_IN_TRANSIT: 3,
  DIASPORA_SHIPMENT_ARRIVED: 6,
  DIASPORA_SHIPMENT_CUSTOMS_HOLD: 3,
  DIASPORA_IMPORT_ORDER_CREATED: 57,
  DIASPORA_PAYMENT_MILESTONE_CREATED: 110,
  DIASPORA_DOCUMENT_UPLOADED: 1,
  'identity.biometric.consent.granted': 6,
});

export const REL03B5_REASON_BY_EVENT = Object.freeze({
  'dealer.onboarding.started': REL03B5_REASON.AUDIT_ONLY_LEGACY,
  DIASPORA_CONTAINER_LOADING: REL03B5_REASON.LEGACY_DUPLICATE_WORKFLOW_EVENT,
  DIASPORA_SHIPMENT_IN_TRANSIT: REL03B5_REASON.LEGACY_DUPLICATE_WORKFLOW_EVENT,
  DIASPORA_SHIPMENT_ARRIVED: REL03B5_REASON.LEGACY_DUPLICATE_WORKFLOW_EVENT,
  DIASPORA_SHIPMENT_CUSTOMS_HOLD: REL03B5_REASON.LEGACY_DUPLICATE_WORKFLOW_EVENT,
  DIASPORA_IMPORT_ORDER_CREATED: REL03B5_REASON.LEGACY_DUPLICATE_DIRECT_NOTIFICATION,
  DIASPORA_PAYMENT_MILESTONE_CREATED: REL03B5_REASON.LEGACY_DUPLICATE_DIRECT_NOTIFICATION,
  DIASPORA_DOCUMENT_UPLOADED: REL03B5_REASON.LEGACY_DUPLICATE_DIRECT_NOTIFICATION,
  'identity.biometric.consent.granted': REL03B5_REASON.RETIRED_HISTORICAL_EVENT,
});

export function assertRel03b5StagingTarget(target) {
  if (!target || target.kind !== 'staging' || target.projectRef !== REL03B5_STAGING_PROJECT_REF) {
    throw new Error('REL-03B-5 TARGET REFUSED: exact CarUp staging target was not proven.');
  }
  return target;
}

export function reasonForHistoricalEvent(eventType) {
  const reason = REL03B5_REASON_BY_EVENT[eventType];
  if (!reason) throw new Error('REL-03B-5 UNKNOWN HISTORICAL FAMILY: ' + String(eventType));
  return reason;
}

export function validateFrozenPopulation(summary) {
  if (!summary || Number(summary.total) !== REL03B5_EXPECTED_TOTAL) {
    throw new Error('REL-03B-5 TOTAL DRIFT: expected 196 frozen rows.');
  }
  if (String(summary.fingerprint || '') !== REL03B5_EXPECTED_FINGERPRINT) {
    throw new Error('REL-03B-5 FINGERPRINT DRIFT: frozen historical population changed.');
  }
  if (Number(summary.locked_rows || 0) !== 0) {
    throw new Error('REL-03B-5 LOCKED ROW STOP: historical candidate is currently locked.');
  }

  const observed = summary.family_counts || {};
  for (const [eventType, expected] of Object.entries(REL03B5_FAMILY_COUNTS)) {
    if (Number(observed[eventType] || 0) !== expected) {
      throw new Error('REL-03B-5 FAMILY DRIFT: ' + eventType + ' expected ' + expected + '.');
    }
  }

  const observedKeys = Object.keys(observed).sort();
  const expectedKeys = Object.keys(REL03B5_FAMILY_COUNTS).sort();
  if (JSON.stringify(observedKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('REL-03B-5 FAMILY SET DRIFT: unexpected event family is present.');
  }
  return true;
}

export function reasonCountsForRows(rows) {
  const counts = {};
  for (const row of rows || []) {
    const reason = row.quarantine_reason || reasonForHistoricalEvent(row.event_type);
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

export function assertReasonTotals(counts) {
  const expected = {
    AUDIT_ONLY_LEGACY: 6,
    LEGACY_DUPLICATE_WORKFLOW_EVENT: 16,
    LEGACY_DUPLICATE_DIRECT_NOTIFICATION: 168,
    RETIRED_HISTORICAL_EVENT: 6,
  };
  for (const [reason, count] of Object.entries(expected)) {
    if (Number(counts?.[reason] || 0) !== count) {
      throw new Error('REL-03B-5 REASON COUNT MISMATCH: ' + reason + '.');
    }
  }
  return true;
}
