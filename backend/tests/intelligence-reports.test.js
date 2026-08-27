/**
 * CarUp Intelligence 1.0 — I19 reports, export and KPI explanations.
 *
 * A report is the most durable form an intelligence figure takes: it is saved,
 * forwarded, and read months later by somebody who was not there when it was
 * produced. So every guarantee the live surfaces make has to survive the export,
 * where the page that explained it does not.
 *
 * The sharpest of those guarantees is that an unmeasured figure must not become a
 * zero. In a spreadsheet an empty cell IS a zero the moment somebody sums the
 * column, so the export writes the words instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import {
  reportRow,
  buildReport,
  buildSellerReport,
  toCsv,
  resolvePeriod,
  PERIODS,
  REPORT_VERSION,
} from '../services/intelligence/reportService.js';
import {
  KPI_CATALOGUE,
  kpiCatalogue,
  explainKpi,
  KPI_CATALOGUE_VERSION,
} from '../services/intelligence/kpiCatalogue.js';
import { AVAILABILITY, AuthorizationError } from '../services/intelligence/intelligenceProjectionService.js';

const OWNER = { id: 'u1', role: 'owner' };
const value = (n, unit = 'count') => ({ availability: AVAILABILITY.VALUE, value: n, unit });
const insufficient = () => ({ availability: AVAILABILITY.INSUFFICIENT_DATA, value: null, reason: 'denominator_below_20' });

// ── Every KPI explains itself, including what it is NOT ────────────────────

test('every KPI carries all four explanation fields', () => {
  for (const entry of KPI_CATALOGUE) {
    assert.ok(entry.key && entry.label, 'a KPI needs a key and a label');
    assert.ok(entry.means, `${entry.key} must say what it means`);
    assert.ok(entry.counted, `${entry.key} must say how it is counted`);
    assert.ok(entry.excludes, `${entry.key} must say what it excludes`);
    // The field that stops the fabrication recurring in a reader's head.
    assert.ok(entry.not, `${entry.key} must name the figure it is most often mistaken for`);
    assert.ok(entry.calculation_version, `${entry.key} must name its calculation version`);
  }
});

test('the near-miss field names the specific confusion each figure invites', () => {
  assert.ok(/not a sale/i.test(explainKpi('inquiries').not));
  assert.ok(/not money lent|a request/i.test(explainKpi('applications_received').not));
  assert.ok(/not money received/i.test(explainKpi('milestones_scheduled').not));
  assert.ok(/not trade value|not money that moved/i.test(explainKpi('sandbox_settlements').not));
  assert.ok(/not value delivered/i.test(explainKpi('referral_benefits_accrued').not));
  assert.ok(/not a government verification/i.test(explainKpi('carup_assessed_evidence').not));
  assert.ok(/not a credit score/i.test(explainKpi('trust_position').not));
});

test('the Trust explanation preserves the not_evaluated rule verbatim', () => {
  const trust = explainKpi('trust_position');
  assert.ok(/never zero, failed or poor/i.test(trust.not));
  assert.ok(/canonical trust service/i.test(trust.counted));
});

test('the catalogue can be filtered by phase and reports its version', () => {
  const all = kpiCatalogue();
  assert.equal(all.calculation_version, KPI_CATALOGUE_VERSION);
  assert.equal(all.count, KPI_CATALOGUE.length);
  const i14 = kpiCatalogue({ phase: 'I14' });
  assert.ok(i14.count >= 2);
  assert.ok(i14.kpis.every((k) => k.phase === 'I14'));
});

// ── An unmeasured figure never becomes a zero ──────────────────────────────

test('an unavailable metric exports as words, never as a blank cell', () => {
  const report = buildReport({
    subject: { type: 'seller', id: 'u1' },
    period: PERIODS.MONTHLY,
    windowDays: 30,
    generatedAt: '2026-08-28T00:00:00.000Z',
    rows: [reportRow('listing_views', insufficient()), reportRow('inquiries', value(4))],
  });
  const csv = toCsv(report);

  assert.ok(csv.includes('NOT MEASURED'),
    'an empty cell becomes a zero the moment a spreadsheet column is summed');
  assert.ok(csv.includes('not measured'));
  assert.ok(/A metric shown as NOT MEASURED has no value in CarUp\. It is not zero\./.test(csv));
  // The measured row still exports its real value.
  assert.ok(/Enquiries,4,/.test(csv));
});

test('an unavailable row keeps a null value rather than an empty string', () => {
  const row = reportRow('listing_views', insufficient());
  assert.equal(row.available, false);
  assert.equal(row.value, null);
  assert.equal(row.reason, 'denominator_below_20');
});

test('a missing metric envelope is unavailable, not zero', () => {
  const row = reportRow('listing_views', undefined);
  assert.equal(row.available, false);
  assert.equal(row.value, null);
});

test('a recorded zero exports as zero, because it is a measurement', () => {
  const report = buildReport({
    subject: { type: 'seller', id: 'u1' },
    period: PERIODS.WEEKLY,
    windowDays: 7,
    generatedAt: '2026-08-28T00:00:00.000Z',
    rows: [reportRow('inquiries', value(0))],
  });
  const csv = toCsv(report);
  assert.ok(/Enquiries,0,/.test(csv));
  assert.ok(!csv.includes('NOT MEASURED'));
});

// ── Provenance survives the export ─────────────────────────────────────────

test('the export carries its versions, window and coverage', () => {
  const report = buildReport({
    subject: { type: 'seller', id: 'u1' },
    period: PERIODS.MONTHLY,
    windowDays: 30,
    generatedAt: '2026-08-28T00:00:00.000Z',
    rows: [reportRow('listing_views', insufficient()), reportRow('inquiries', value(4))],
  });
  assert.equal(report.coverage.total, 2);
  assert.equal(report.coverage.available, 1);
  assert.equal(report.coverage.unavailable, 1);
  assert.ok(/could not be measured/i.test(report.coverage.note));

  const csv = toCsv(report);
  assert.ok(csv.includes(REPORT_VERSION));
  assert.ok(csv.includes(KPI_CATALOGUE_VERSION));
  assert.ok(csv.includes('Covers 30 days'));
});

test('a fully measured report carries no coverage warning', () => {
  const report = buildReport({
    subject: { type: 'seller', id: 'u1' },
    period: PERIODS.WEEKLY,
    windowDays: 7,
    generatedAt: '2026-08-28T00:00:00.000Z',
    rows: [reportRow('inquiries', value(4))],
  });
  assert.equal(report.coverage.note, null);
});

test('each exported row carries the explanation a spreadsheet reader cannot hover for', () => {
  const csv = toCsv(buildReport({
    subject: { type: 'seller', id: 'u1' },
    period: PERIODS.MONTHLY,
    windowDays: 30,
    generatedAt: '2026-08-28T00:00:00.000Z',
    rows: [reportRow('inquiries', value(4))],
  }));
  assert.ok(csv.includes('what_it_means'));
  assert.ok(csv.includes('what_it_is_not'));
  assert.ok(/not a sale/i.test(csv));
});

test('CSV fields containing commas or quotes are escaped', () => {
  const csv = toCsv(buildReport({
    subject: { type: 'seller', id: 'u1' },
    period: PERIODS.MONTHLY,
    windowDays: 30,
    generatedAt: '2026-08-28T00:00:00.000Z',
    rows: [reportRow('trust_position', value(1))],
  }));
  // The Trust explanation contains commas; the row must stay one line.
  const dataLines = csv.split('\n').filter((l) => l.startsWith('Trust'));
  assert.equal(dataLines.length, 1);
  assert.ok(dataLines[0].includes('"'));
});

// ── A failed projection produces a report that says so ─────────────────────

test('an unreadable projection yields a report of unavailability, not of zero activity', async () => {
  const report = await buildSellerReport(
    { availability: AVAILABILITY.UNAVAILABLE, reason: 'ledger_read_failed' },
    { actor: OWNER },
  );
  assert.equal(report.availability, AVAILABILITY.UNAVAILABLE);
  assert.deepEqual(report.rows, []);
  assert.ok(/not a report of zero activity/i.test(report.message));
});

test('a seller report is built from the projection and needs a session', async () => {
  await assert.rejects(
    () => buildSellerReport({ availability: AVAILABILITY.VALUE, metrics: {} }, { actor: null }),
    AuthorizationError,
  );

  const report = await buildSellerReport({
    availability: AVAILABILITY.VALUE,
    metrics: { views: value(120), inquiries: value(4), unique_visitors: value(88) },
  }, { actor: OWNER, period: 'weekly', now: new Date('2026-08-28T00:00:00.000Z') });

  assert.equal(report.period, PERIODS.WEEKLY);
  assert.equal(report.window_days, 7);
  assert.equal(report.subject.id, 'u1');
  const byKey = Object.fromEntries(report.rows.map((r) => [r.key, r]));
  assert.equal(byKey.listing_views.value, 120);
  // Completeness and lost opportunity were not in the projection, so they are
  // unavailable rather than absent or zero.
  assert.equal(byKey.listing_completeness.available, false);
  assert.equal(byKey.lost_opportunity.available, false);
});

test('the period resolver defaults to monthly and accepts weekly', () => {
  assert.equal(resolvePeriod('weekly'), PERIODS.WEEKLY);
  assert.equal(resolvePeriod('WEEKLY'), PERIODS.WEEKLY);
  assert.equal(resolvePeriod('monthly'), PERIODS.MONTHLY);
  assert.equal(resolvePeriod('nonsense'), PERIODS.MONTHLY);
  assert.equal(resolvePeriod(undefined), PERIODS.MONTHLY);
});
