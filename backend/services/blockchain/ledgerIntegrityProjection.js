/**
 * Ledger integrity — the ONLY shape `verifyChain` output may take when it leaves the server through
 * `GET /api/vehicles/:vin/verify-ledger` (OC-3B).
 *
 * `verifyChain(vin)` returns the checked chain: every event with its PARSED payload (owner names,
 * national ids, stakeholder ids in practice), its hash, its signature (whose prefix is the signer's
 * user id) and, on failure, a `reason` string that names event ids and actors. None of that is
 * needed to answer "is this vehicle's ledger intact?", and every byte of it is private.
 *
 * Built by ALLOW-LIST, never by deleting keys from the report: a field `verifyChain` grows tomorrow
 * must not reach a caller by default.
 */

/** 'verified' | 'broken' | 'empty' — the only three integrity states a caller is told. */
export function ledgerIntegrityState(report) {
  if (!report || report.verified !== true) return 'broken';
  return Number(report.count) > 0 ? 'verified' : 'empty';
}

export function toLedgerIntegrityReport(vin, report, verifiedAt = new Date()) {
  const integrity = ledgerIntegrityState(report);
  const projected = {
    vin: String(vin),
    verified: integrity !== 'broken',
    // A broken chain's verifyChain report carries no `count`; the number of events that checked out
    // before the break is the failure index, which is reported separately below.
    count: integrity === 'broken' ? null : Number(report.count) || 0,
    integrity,
    verified_at: (verifiedAt instanceof Date ? verifiedAt : new Date(verifiedAt)).toISOString(),
  };
  if (integrity === 'broken' && Number.isInteger(report?.tamperIndex)) {
    projected.failed_at_index = report.tamperIndex;
  }
  return projected;
}

export default { ledgerIntegrityState, toLedgerIntegrityReport };
