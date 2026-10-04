/**
 * OC-P0L production-security hotfix — what `GET /api/vehicles/:vin/verify-ledger` may return.
 *
 * Before this hotfix the route was anonymous and returned `verifyChain(vin)` verbatim: `chain[]` with
 * every ledger event's PARSED payload (owner names, national ids, stakeholder ids in practice), its
 * hash, its signature (whose prefix is the signer's user id) and, on failure, a `reason` naming event
 * ids and actors.
 *
 * EXPOSURE ONLY. This module changes what LEAVES the server, never what the verifier concludes.
 * `verified` is the production verifier's own boolean, unchanged — including `verified: true` for a
 * vehicle with no ledger events, because the production web client renders anything but
 * `verified === true` as "Tampered", and this hotfix must not start accusing every vehicle without
 * history of tampering. The corrected contract (an empty ledger is not "verified", with a client that
 * renders a third state) ships with the One CarUp release candidate, not here.
 *
 * Built by ALLOW-LIST, never by deleting keys from the report: a field `verifyChain` grows tomorrow
 * must not reach a caller by default.
 */

/** 'verified' | 'broken' | 'empty' — derived for the response; the verdict itself is unchanged. */
export function ledgerIntegrityState(report) {
  if (!report || report.verified !== true) return 'broken';
  return Number(report.count) > 0 ? 'verified' : 'empty';
}

export function toLedgerIntegrityReport(vin, report, verifiedAt = new Date()) {
  const integrity = ledgerIntegrityState(report);
  const projected = {
    vin: String(vin),
    verified: report?.verified === true,
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
