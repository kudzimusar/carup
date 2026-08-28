/**
 * CarUp Intelligence 1.0 — I19 KPI explanations.
 *
 * A user-facing explanation for every KPI the programme publishes.
 *
 * Each entry answers four questions a reader actually asks, in this order:
 *
 *   what it means      — in plain language, without the schema;
 *   how it is counted  — the authoritative source and the rule;
 *   what it excludes   — the part people get wrong;
 *   what it is not     — the adjacent figure it is most often mistaken for.
 *
 * The fourth field is the one that earns its place. Almost every fabrication this
 * programme removed was a figure standing in for a neighbouring one it resembled:
 * a requested loan amount read as money lent, a sandbox settlement read as a
 * settlement, a scheduled milestone read as money received, an accrued referral
 * benefit read as a payout, CarUp's own document review read as a government
 * verification. Naming the near-miss is what stops it recurring in a reader's head
 * after the code has been fixed.
 */

export const KPI_CATALOGUE_VERSION = 'kpi_catalogue@1';

export const KPI_CATALOGUE = Object.freeze([
  // ── Marketplace / seller ────────────────────────────────────────────────
  {
    key: 'listing_views',
    label: 'Listing views',
    phase: 'I4',
    calculation_version: 'rollup@1',
    means: 'How many times your listing was opened by somebody looking at the marketplace.',
    counted: 'From the activity ledger, one event per listing open, de-duplicated within a session.',
    excludes: 'Your own visits to your own listing, traffic flagged as internal, and known automated traffic.',
    not: 'Not the number of PEOPLE who looked. One person returning three times is three views and one visitor.',
  },
  {
    key: 'unique_visitors',
    label: 'Unique visitors',
    phase: 'I4',
    calculation_version: 'rollup@1',
    means: 'How many distinct people opened your listing.',
    counted: 'Distinct actor keys over the period.',
    excludes: 'The same exclusions as views.',
    not: 'Not a count of accounts. Somebody browsing signed out is counted, and CarUp does not know who they are.',
  },
  {
    key: 'inquiries',
    label: 'Enquiries',
    phase: 'I4',
    calculation_version: 'rollup@1',
    means: 'How many people contacted you about a listing.',
    counted: 'Rows in the authoritative enquiry table, which is the record of the enquiry itself rather than a behavioural event.',
    excludes: 'Enquiries marked spam or rejected.',
    not: 'Not a sale, and not a viewing. It is the first contact.',
  },
  {
    key: 'listing_completeness',
    label: 'Listing completeness',
    phase: 'I6',
    calculation_version: 'completeness@LC1',
    means: 'How much of the detail buyers filter on your listing actually records.',
    counted: 'A fixed rubric of fields, each either recorded or not.',
    excludes: 'Anything subjective. Photo quality and description wording are not scored.',
    not: 'Not a quality or desirability score, and not related to Trust. A complete listing can still be a poor one.',
  },
  {
    key: 'lost_opportunity',
    label: 'Lost opportunity',
    phase: 'I6',
    calculation_version: 'lost_opportunity@LO1',
    means: 'Searches your listing would have matched had a missing field been recorded.',
    counted: 'Filtered searches whose criteria your listing meets on every recorded field but fails only on a missing one.',
    excludes: 'Searches your listing genuinely does not match.',
    not: 'Not lost sales, and not lost money. It is lost visibility.',
  },

  // ── Trust and evidence ──────────────────────────────────────────────────
  {
    key: 'trust_position',
    label: 'Trust',
    phase: 'I0',
    calculation_version: 'canonical trust service',
    means: 'How much confidence CarUp places in the evidence it holds about a vehicle.',
    counted: 'Only by the canonical trust service, and only where an evaluation exists under the current calculation version.',
    excludes: 'Everything about the seller and everything about the buyer.',
    not: 'Not a credit score, not an insurance risk rating, and not a statement that a vehicle is good. "Not evaluated" means not evaluated — it is never zero, failed or poor.',
  },
  {
    key: 'carup_assessed_evidence',
    label: 'Evidence CarUp reviewed',
    phase: 'I15',
    calculation_version: 'government_provenance@1',
    means: 'Documents somebody supplied that CarUp has reviewed.',
    counted: 'Rows in the evidence table with a completed review.',
    excludes: 'Anything not yet reviewed.',
    not: 'Not a government verification and not a registry confirmation. No registry has confirmed anything held by CarUp.',
  },

  // ── Finance ─────────────────────────────────────────────────────────────
  {
    key: 'applications_received',
    label: 'Applications received',
    phase: 'I11',
    calculation_version: 'finance_demand@1',
    means: 'Finance applications CarUp has recorded for you.',
    counted: 'Rows attached to your lender identity.',
    excludes: 'Applications attached to no lender, which are disclosed separately.',
    not: 'Not approvals and not money lent. An application is a request.',
  },
  {
    key: 'decisions_recorded',
    label: 'Decisions recorded',
    phase: 'I11',
    calculation_version: 'finance_demand@1',
    means: 'Applications where a lender decision was actually recorded.',
    counted: 'Only where a decision timestamp or decision source exists.',
    excludes: 'A bare status string. Nothing in CarUp sets a status on a lender\'s behalf, so a status alone is not an outcome.',
    not: 'Not approvals specifically — a recorded decline is also a decision.',
  },

  // ── Trade ───────────────────────────────────────────────────────────────
  {
    key: 'milestones_scheduled',
    label: 'Payment milestones scheduled',
    phase: 'I13',
    calculation_version: 'trade_demand@1',
    means: 'Payments agreed as part of an import order.',
    counted: 'Milestone rows attached to orders in your scope.',
    excludes: 'Nothing — every scheduled milestone counts.',
    not: 'Not money received. A milestone is confirmed only when somebody confirms it, and on CarUp none has been.',
  },
  {
    key: 'sandbox_settlements',
    label: 'Sandbox settlements',
    phase: 'I13',
    calculation_version: 'trade_demand@1',
    means: 'Escrow sessions that completed against a simulated payment provider.',
    counted: 'Sessions whose provider mode is sandbox and whose status is settled.',
    excludes: 'Live sessions, which are counted separately and of which there are none.',
    not: 'Not trade value and not money that moved. A sandbox settlement is a real record of a simulation.',
  },

  // ── Referral ────────────────────────────────────────────────────────────
  {
    key: 'referral_events',
    label: 'Referral activity',
    phase: 'I14',
    calculation_version: 'referral_performance@1',
    means: 'Things people did with referral codes and coupons.',
    counted: 'Only referral-domain event types.',
    excludes: 'Everything else in the same table — trust disputes, agent tool runs, AI marketing drafts and marketplace events all share it. The excluded count is published alongside.',
    not: 'Not the size of the event table, which is several times larger.',
  },
  {
    key: 'referral_benefits_accrued',
    label: 'Referral benefits accrued',
    phase: 'I14',
    calculation_version: 'referral_performance@1',
    means: 'Value promised to referrers.',
    counted: 'Wallet transactions, grouped by their own currency.',
    excludes: 'Nothing.',
    not: 'Not value delivered. No referral reward has been paid, and paid value is reported as its own separate figure.',
  },

  // ── Parts and service ───────────────────────────────────────────────────
  {
    key: 'parts_verified',
    label: 'Parts verified',
    phase: 'I12',
    calculation_version: 'parts_demand@1',
    means: 'PartSentry records whose part verification is complete.',
    counted: 'Logs with a verified part status.',
    excludes: 'Logs still awaiting verification.',
    not: 'Not a fraud finding. A record flagged for review can also be a verified one; flagging is a review input, not a verdict.',
  },
  {
    key: 'completion_rate',
    label: 'Completion rate',
    phase: 'I9',
    calculation_version: 'service@1',
    means: 'The share of work orders that reached a completed state.',
    counted: 'Completed orders over all orders in the period, and only where there are enough orders to be meaningful.',
    excludes: 'Periods with too few orders, which report insufficient data rather than a misleading percentage.',
    not: 'Not turnaround time, which CarUp does not measure.',
  },
]);

const BY_KEY = new Map(KPI_CATALOGUE.map((entry) => [entry.key, entry]));

export function explainKpi(key) {
  return BY_KEY.get(key) || null;
}

/**
 * Every KPI, or the subset for one phase.
 *
 * Returned as data rather than rendered text so the same explanation can serve an
 * in-product tooltip, an exported report and a stakeholder manual without three
 * copies drifting apart.
 */
export function kpiCatalogue({ phase = null } = {}) {
  const entries = phase
    ? KPI_CATALOGUE.filter((entry) => entry.phase === phase)
    : KPI_CATALOGUE;
  return {
    calculation_version: KPI_CATALOGUE_VERSION,
    count: entries.length,
    kpis: entries.map((entry) => ({ ...entry })),
  };
}
