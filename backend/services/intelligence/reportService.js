/**
 * CarUp Intelligence 1.0 — I19 periodic summaries and export.
 *
 * A report is the most durable form an intelligence figure takes. It gets saved,
 * forwarded, and read months later by somebody who was not there when it was
 * produced — so every guarantee the live surfaces make has to survive the export,
 * where the surrounding page that explained it does not.
 *
 * Three things therefore travel INSIDE the report rather than around it:
 *
 *   PROVENANCE. Every row carries the calculation version that produced it and the
 *   window it covers. A figure whose definition later changes cannot be silently
 *   compared against a new one.
 *
 *   UNAVAILABILITY. A metric that could not be measured is exported as a row
 *   saying so, never as a blank cell and never as a zero. A blank in a spreadsheet
 *   becomes a zero the moment somebody sums the column.
 *
 *   THE NEAR-MISS. Each row carries the "what it is not" line from the KPI
 *   catalogue, because the reader of an exported CSV has no tooltip to hover.
 */
import { AVAILABILITY, AuthorizationError } from './intelligenceProjectionService.js';
import { explainKpi, KPI_CATALOGUE_VERSION } from './kpiCatalogue.js';

export const REPORT_VERSION = 'report@1';

export const PERIODS = Object.freeze({ WEEKLY: 'weekly', MONTHLY: 'monthly' });

const PERIOD_DAYS = Object.freeze({ [PERIODS.WEEKLY]: 7, [PERIODS.MONTHLY]: 30 });

export function resolvePeriod(raw) {
  const period = String(raw || '').toLowerCase();
  return period === PERIODS.WEEKLY ? PERIODS.WEEKLY : PERIODS.MONTHLY;
}

/**
 * One exported line.
 *
 * `available: false` rows are first-class. The reason is what the reader needs,
 * and the value stays null rather than becoming an empty string that a spreadsheet
 * will happily treat as zero.
 */
export function reportRow(key, metricEnvelope, { label = null } = {}) {
  const explanation = explainKpi(key);
  const available = Boolean(metricEnvelope)
    && metricEnvelope.availability === AVAILABILITY.VALUE
    && metricEnvelope.value !== null
    && metricEnvelope.value !== undefined;

  return {
    key,
    label: label || explanation?.label || key,
    value: available ? metricEnvelope.value : null,
    unit: metricEnvelope?.unit || null,
    available,
    reason: available ? null : (metricEnvelope?.reason || metricEnvelope?.availability || 'not_recorded'),
    // Carried into the export because a CSV has no tooltip.
    means: explanation?.means || null,
    not: explanation?.not || null,
    calculation_version: explanation?.calculation_version || null,
  };
}

/**
 * Assemble a report from projection payloads that were already computed under
 * their own governance. Nothing is recomputed here.
 */
export function buildReport({ subject, period, windowDays, rows, generatedAt, coverage = null }) {
  const unavailable = rows.filter((row) => !row.available);
  return {
    report_version: REPORT_VERSION,
    kpi_catalogue_version: KPI_CATALOGUE_VERSION,
    subject,
    period,
    window_days: windowDays,
    generated_at: generatedAt,
    rows,
    // Stated up front so a reader meets the gaps before the numbers, not after.
    coverage: coverage || {
      total: rows.length,
      available: rows.length - unavailable.length,
      unavailable: unavailable.length,
      note: unavailable.length === 0
        ? null
        : `${unavailable.length} of ${rows.length} figures could not be measured for this period and are reported as unavailable, not as zero.`,
    },
  };
}

/** Escape one CSV field. */
function csvField(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Render a report as CSV.
 *
 * An unavailable metric exports the literal text `NOT MEASURED` in its value
 * column rather than an empty cell. This is deliberate and slightly ugly: an empty
 * cell is indistinguishable from a zero once the file is opened in a spreadsheet
 * and a column is summed, and the whole programme exists to stop that.
 */
export function toCsv(report) {
  const header = ['metric', 'value', 'unit', 'status', 'reason', 'what_it_means', 'what_it_is_not', 'calculation_version'];
  const lines = [header.join(',')];

  for (const row of report.rows) {
    lines.push([
      csvField(row.label),
      csvField(row.available ? row.value : 'NOT MEASURED'),
      csvField(row.unit),
      csvField(row.available ? 'measured' : 'not measured'),
      csvField(row.reason),
      csvField(row.means),
      csvField(row.not),
      csvField(row.calculation_version),
    ].join(','));
  }

  // The provenance footer travels with the file, because the page that would have
  // explained it does not.
  lines.push('');
  lines.push(csvField(`Report version ${report.report_version}; KPI definitions ${report.kpi_catalogue_version}.`));
  lines.push(csvField(`Covers ${report.window_days} days to ${report.generated_at}.`));
  if (report.coverage?.note) lines.push(csvField(report.coverage.note));
  // The legend appears only when the symbol does; explaining an absent marker is
  // noise, and noise is what stops footers being read.
  if (report.rows.some((row) => !row.available)) {
    lines.push(csvField('A metric shown as NOT MEASURED has no value in CarUp. It is not zero.'));
  }

  return lines.join('\n');
}

/**
 * A seller's periodic summary.
 *
 * Built from the seller projection that already applies the ownership scope, so
 * there is no subject parameter here either.
 */
export async function buildSellerReport(sellerPulse, { period = PERIODS.MONTHLY, actor = null, now = new Date() } = {}) {
  if (!actor?.id) throw new AuthorizationError('Authentication required.');
  const resolved = resolvePeriod(period);

  // An unreadable projection produces a report that says so, not an empty one.
  if (!sellerPulse || sellerPulse.availability === AVAILABILITY.UNAVAILABLE) {
    return {
      report_version: REPORT_VERSION,
      kpi_catalogue_version: KPI_CATALOGUE_VERSION,
      subject: { type: 'seller', id: String(actor.id) },
      period: resolved,
      window_days: PERIOD_DAYS[resolved],
      generated_at: now.toISOString(),
      availability: AVAILABILITY.UNAVAILABLE,
      reason: sellerPulse?.reason || 'projection_unavailable',
      rows: [],
      message: 'This report could not be produced because the underlying figures could not be read. It is not a report of zero activity.',
    };
  }

  const metrics = sellerPulse.metrics || {};
  const rows = [
    reportRow('listing_views', metrics.views),
    reportRow('unique_visitors', metrics.unique_visitors),
    reportRow('inquiries', metrics.inquiries),
    reportRow('listing_completeness', metrics.completeness),
    reportRow('lost_opportunity', metrics.lost_opportunity),
  ];

  return {
    ...buildReport({
      subject: { type: 'seller', id: String(actor.id) },
      period: resolved,
      windowDays: PERIOD_DAYS[resolved],
      rows,
      generatedAt: now.toISOString(),
    }),
    availability: AVAILABILITY.VALUE,
  };
}
