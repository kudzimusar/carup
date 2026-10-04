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

/**
 * `verified` is true ONLY when `integrity === 'verified'` (OC-3B-R). An empty ledger verified nothing:
 * reporting it `verified: true` repeated production's `{"verified":true,"count":0,"chain":[]}` for an
 * unknown VIN inside the safe envelope, and `verified` is the field a client reads first. So
 * `verified: false` means "not verified" — broken OR empty — and `integrity` says which.
 */
export function toLedgerIntegrityReport(vin, report, verifiedAt = new Date()) {
  const integrity = ledgerIntegrityState(report);
  const projected = {
    vin: String(vin),
    verified: integrity === 'verified',
    // A broken chain's verifyChain report carries no `count`; the number of events that checked out
    // before the break is the failure index, which is reported separately below. An empty ledger has
    // exactly zero events, whatever malformed count the report carried.
    count: integrity === 'verified' ? Number(report.count) : integrity === 'empty' ? 0 : null,
    integrity,
    verified_at: (verifiedAt instanceof Date ? verifiedAt : new Date(verifiedAt)).toISOString(),
  };
  if (integrity === 'broken' && Number.isInteger(report?.tamperIndex)) {
    projected.failed_at_index = report.tamperIndex;
  }
  return projected;
}

export default { ledgerIntegrityState, toLedgerIntegrityReport };
