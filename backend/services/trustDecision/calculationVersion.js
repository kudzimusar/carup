/**
 * The Trust decision rules version, in a module with no imports so that callers which load the
 * Trust services lazily (the Golden fixture) can still compare against it without pulling the
 * service graph in at import time. trustDecisionService re-exports it; there is one constant.
 *
 * A version names one fixed scoring function (INV-TRUST-4). Any change to what the score,
 * confidence or evidence basis is computed from is a new version, and every cache row stamped
 * with an older one is reported `stale` until refreshCanonicalTrust re-derives it.
 *
 * 1.1.0 (OC-5R-PROV-01 A1): only AUTHENTICATED authority evidence (`source_connected`) counts as
 * a connected source. Partner-file and CarUp manual-review results are retained and disclosed as
 * `reviewed`, but no longer add to the score, the connected-source count, confidence, Gold or the
 * eligibility source floor. 1.0.0 counted them as connected.
 */
export const CALCULATION_VERSION = 'trust-decision-1.1.0';
