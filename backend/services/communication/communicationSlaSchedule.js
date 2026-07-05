// Business-hours-aware SLA deadline engine (plan §10 / P1.9).
//
// Selects the relevant tenant/channel/priority policy and computes first-response / next-response /
// resolution deadlines by adding the policy's minutes only DURING configured business hours, in the
// policy timezone — rolling over closed evenings, weekends, and holidays. Timezone/DST-safe using
// Intl (no external dependency). Pure + unit-tested (incl. a DST boundary).
//
// business_hours JSONB shape:
//   { days: { "0".."6": ["09:00","17:00"] | null }, holidays: ["2026-12-25", ...] }
//   where 0 = Sunday … 6 = Saturday; a missing/null day is closed. An absent/empty `days` means
//   "24/7" (plain wall-clock minutes). Holiday behaviour: an ISO calendar date in `holidays` is
//   treated as fully closed (same as a closed weekday); recurring/observed holidays are the operator's
//   responsibility to enumerate.

// Wall-clock parts of a UTC instant in a timezone.
function zonedParts(instant, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date(instant))) p[part.type] = part.value;
  const hour = Number(p.hour) === 24 ? 0 : Number(p.hour);
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour, minute: Number(p.minute), second: Number(p.second) };
}

// Timezone offset (ms) at an instant: localWallClockAsUTC - instant.
function tzOffsetMs(instant, timeZone) {
  const p = zonedParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
}

// UTC instant for a local wall-clock time in a timezone (DST-safe by converging the offset).
function wallClockToUtc(y, mo, d, hh, mm, timeZone) {
  const target = Date.UTC(y, mo - 1, d, hh, mm, 0);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const corrected = target - tzOffsetMs(guess, timeZone);
    if (corrected === guess) break;
    guess = corrected;
  }
  return guess;
}

function weekdayOf(y, mo, d) {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = Sunday
}

function windowFor(p, businessHours) {
  const dateStr = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  if ((businessHours.holidays || []).includes(dateStr)) return null;
  const wd = weekdayOf(p.year, p.month, p.day);
  const days = businessHours.days || {};
  return days[wd] || days[String(wd)] || null;
}

function nextDayStartUtc(p, timeZone) {
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return wallClockToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone);
}

/**
 * Add `minutes` of business time to a start instant within business hours.
 * @returns {number} the UTC epoch-ms deadline.
 */
export function addBusinessMinutes(startInstant, minutes, businessHours, timeZone = 'UTC') {
  if (!businessHours || !businessHours.days || !Object.keys(businessHours.days).length) {
    return startInstant + Math.max(0, minutes) * 60000; // 24/7
  }
  let cur = startInstant;
  let remaining = Math.max(0, minutes);
  let guard = 0;
  while (remaining > 0 && guard < 4000) {
    guard += 1;
    const p = zonedParts(cur, timeZone);
    const window = windowFor(p, businessHours);
    if (!window) { cur = nextDayStartUtc(p, timeZone); continue; }
    const [openH, openM] = String(window[0]).split(':').map(Number);
    const [closeH, closeM] = String(window[1]).split(':').map(Number);
    const openUtc = wallClockToUtc(p.year, p.month, p.day, openH, openM, timeZone);
    const closeUtc = wallClockToUtc(p.year, p.month, p.day, closeH, closeM, timeZone);
    if (cur < openUtc) { cur = openUtc; continue; }
    if (cur >= closeUtc) { cur = nextDayStartUtc(p, timeZone); continue; }
    const availMinutes = Math.floor((closeUtc - cur) / 60000);
    if (availMinutes >= remaining) return cur + remaining * 60000;
    remaining -= availMinutes;
    cur = closeUtc;
  }
  return cur;
}

// Select the best-matching active policy (most specific tenant/channel/priority wins).
export function selectSlaPolicy(policies = [], { tenantId = null, channel = null, priority = null } = {}) {
  const eligible = policies.filter((p) => p.active !== false
    && (p.tenant_id == null || String(p.tenant_id) === String(tenantId))
    && (p.channel == null || String(p.channel) === String(channel))
    && (p.priority == null || String(p.priority) === String(priority)));
  const score = (p) => (String(p.tenant_id ?? '') === String(tenantId ?? '') && p.tenant_id != null ? 8 : p.tenant_id == null ? 1 : 0)
    + (String(p.channel ?? '') === String(channel ?? '') && p.channel != null ? 4 : p.channel == null ? 1 : 0)
    + (String(p.priority ?? '') === String(priority ?? '') && p.priority != null ? 2 : p.priority == null ? 1 : 0);
  eligible.sort((a, b) => score(b) - score(a));
  return eligible[0] || null;
}

/**
 * Compute the first/next/resolution deadlines from a policy and a start time.
 * @returns {{ first_response_due_at, next_response_due_at, resolution_due_at, sla_policy_id, sla_business_timezone }}
 */
export function computeSlaDeadlines(policy, startIso) {
  if (!policy) return {};
  const start = Date.parse(startIso);
  const base = Number.isNaN(start) ? Date.now() : start;
  const tz = policy.business_timezone || policy.timezone || 'UTC';
  const bh = policy.business_hours && policy.business_hours.days ? policy.business_hours : null;
  const at = (minutes) => (minutes == null ? null : new Date(addBusinessMinutes(base, Number(minutes), bh, tz)).toISOString());
  return {
    first_response_due_at: at(policy.first_response_minutes),
    next_response_due_at: at(policy.next_response_minutes),
    resolution_due_at: at(policy.resolution_minutes),
    sla_policy_id: policy.id ?? null,
    sla_business_timezone: tz,
  };
}
