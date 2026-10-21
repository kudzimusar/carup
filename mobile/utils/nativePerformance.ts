export type NativeMetricName =
  | 'app.cold_start_usable'
  | 'app.warm_resume'
  | 'api.marketplace'
  | 'api.marketplace_action'
  | 'api.owner_vehicles'
  | 'api.owner_service_history'
  | 'image.vehicle_loaded'
  | 'upload.odometer_queued';

export interface NativePerformanceSample {
  name: NativeMetricName;
  recordedAt: number;
  durationMs?: number;
  status?: number;
  payloadBytes?: number | null;
  width?: number;
  height?: number;
}

const MAX_SAMPLES = 120;
const samples: NativePerformanceSample[] = [];
const processStartedAt = Date.now();
let coldStartRecorded = false;
let warmResumeStartedAt: number | null = null;

export function nativeNow(): number {
  const perf = globalThis.performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

function push(sample: NativePerformanceSample): void {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

export function recordNativeMetric(
  name: NativeMetricName,
  detail: Omit<NativePerformanceSample, 'name' | 'recordedAt'> = {},
): void {
  push({
    name,
    recordedAt: Date.now(),
    ...detail,
  });
}

export function recordNetworkResponse(
  name: Extract<NativeMetricName, 'api.marketplace' | 'api.marketplace_action' | 'api.owner_vehicles' | 'api.owner_service_history'>,
  startedAt: number,
  response: Response,
): void {
  const rawLength = response.headers?.get?.('content-length');
  const payloadBytes = rawLength && /^\d+$/.test(rawLength) ? Number(rawLength) : null;
  recordNativeMetric(name, {
    durationMs: Math.max(0, nativeNow() - startedAt),
    status: response.status,
    payloadBytes,
  });
}

export function markColdStartUsable(): void {
  if (coldStartRecorded) return;
  coldStartRecorded = true;
  recordNativeMetric('app.cold_start_usable', {
    durationMs: Math.max(0, Date.now() - processStartedAt),
  });
}

export function markWarmResumeStart(): void {
  warmResumeStartedAt = nativeNow();
}

export function markWarmResumeUsable(): void {
  if (warmResumeStartedAt === null) return;
  recordNativeMetric('app.warm_resume', {
    durationMs: Math.max(0, nativeNow() - warmResumeStartedAt),
  });
  warmResumeStartedAt = null;
}

/**
 * In-memory only. No user ids, VINs, OCR values, file paths or media URLs are
 * recorded. Device evidence tooling may read this snapshot during controlled UAT.
 */
export function getNativePerformanceSnapshot(): NativePerformanceSample[] {
  return samples.map((sample) => ({ ...sample }));
}

export function resetNativePerformanceSnapshot(): void {
  samples.splice(0, samples.length);
  coldStartRecorded = false;
  warmResumeStartedAt = null;
}

/* ───────────────────────────── Bounded network waits ─────────────────────────────
 * CARUP-MVP-STAB-01 F-015: start-up fetched /api/auth/me and /api/features/effective with no time
 * limit, and Android's default HTTP client never times out, so a stalled network held the app on
 * its start-up screen indefinitely.
 */

export class NativeTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = 'NativeTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function isNativeTimeoutError(error: unknown): boolean {
  return error instanceof NativeTimeoutError || (error as { name?: unknown } | null)?.name === 'NativeTimeoutError';
}

/**
 * Settle with `promise`, or reject with NativeTimeoutError after `timeoutMs` (calling `onTimeout`
 * first, e.g. to abort the request). The timer is always cleared once the promise settles.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new NativeTimeoutError(timeoutMs));
      }
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * `fetch` that gives up after `timeoutMs`: the request is aborted and the caller receives a
 * NativeTimeoutError even if the fetch implementation ignores the abort signal.
 */
export function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const request = fetchImpl(input, controller ? { ...init, signal: controller.signal } : init);
  return withTimeout(request, timeoutMs, () => controller?.abort());
}

/* ───────────────────────────── Start-up phases ─────────────────────────────
 * CARUP-MVP-STAB-01 F-016: each start-up phase is recorded once, as milliseconds since this module
 * was evaluated (the first app module the root layout loads), and exactly one structured line is
 * written when Home first renders or the recovery screen first shows:
 *
 *   [carup-startup] {"v":1,"trigger":"home_rendered","epoch_ms":…,"phases_ms":{…},"auth_me":{…},"governance_ok":…}
 *
 * so `adb logcat -s ReactNativeJS` captures the timings. No account, vehicle or device identifier
 * is ever recorded: a phase carries only a time, an HTTP status, a fixed outcome word or a boolean.
 */

export type NativeStartupPhase =
  | 'process_start'
  | 'js_mounted'
  | 'securestore_read_start'
  | 'securestore_read_end'
  | 'auth_me_start'
  | 'auth_me_end'
  | 'governance_start'
  | 'governance_end'
  | 'router_ready'
  | 'home_rendered'
  | 'recovery_shown';

export const NATIVE_STARTUP_PHASES: readonly NativeStartupPhase[] = [
  'process_start',
  'js_mounted',
  'securestore_read_start',
  'securestore_read_end',
  'auth_me_start',
  'auth_me_end',
  'governance_start',
  'governance_end',
  'router_ready',
  'home_rendered',
  'recovery_shown',
];

export const STARTUP_LOG_PREFIX = '[carup-startup]';

export type NativeStartupTrigger = 'home_rendered' | 'recovery_shown';

export interface NativeStartupDetail {
  status?: number | null;
  outcome?: string | null;
  ok?: boolean | null;
}

interface NativeStartupMark extends NativeStartupDetail {
  atMs: number;
}

export interface NativeStartupSummary {
  v: 1;
  trigger: NativeStartupTrigger;
  epoch_ms: number;
  phases_ms: Partial<Record<NativeStartupPhase, number>>;
  auth_me: { status: number | null; outcome: string | null } | null;
  governance_ok: boolean | null;
}

let startupEpochMs = processStartedAt;
let startupPerfOrigin = nativeNow();
const startupMarks = new Map<NativeStartupPhase, NativeStartupMark>([['process_start', { atMs: 0 }]]);
let startupSummaryEmitted = false;

function safeStartupDetail(detail: NativeStartupDetail): NativeStartupDetail {
  const safe: NativeStartupDetail = {};
  if (typeof detail.status === 'number' && Number.isFinite(detail.status)) safe.status = detail.status;
  if (typeof detail.outcome === 'string' && /^[a-z_]{1,32}$/.test(detail.outcome)) safe.outcome = detail.outcome;
  if (typeof detail.ok === 'boolean') safe.ok = detail.ok;
  return safe;
}

function defaultStartupEmit(prefix: string, line: string): void {
  console.info(prefix, line);
}

export function getNativeStartupSummary(trigger: NativeStartupTrigger): NativeStartupSummary {
  const phasesMs: Partial<Record<NativeStartupPhase, number>> = {};
  for (const phase of NATIVE_STARTUP_PHASES) {
    const mark = startupMarks.get(phase);
    if (mark) phasesMs[phase] = mark.atMs;
  }
  const authEnd = startupMarks.get('auth_me_end');
  const governanceEnd = startupMarks.get('governance_end');
  return {
    v: 1,
    trigger,
    epoch_ms: startupEpochMs,
    phases_ms: phasesMs,
    auth_me: authEnd ? { status: authEnd.status ?? null, outcome: authEnd.outcome ?? null } : null,
    governance_ok: typeof governanceEnd?.ok === 'boolean' ? governanceEnd.ok : null,
  };
}

/** Write the one start-up line. Returns false (and writes nothing) once it has been written. */
export function emitStartupSummaryOnce(
  trigger: NativeStartupTrigger,
  emit: (prefix: string, line: string) => void = defaultStartupEmit,
): boolean {
  if (startupSummaryEmitted) return false;
  startupSummaryEmitted = true;
  emit(STARTUP_LOG_PREFIX, JSON.stringify(getNativeStartupSummary(trigger)));
  return true;
}

/** Record a start-up phase once; Home rendering or the recovery screen writes the summary line. */
export function markStartupPhase(
  phase: NativeStartupPhase,
  detail: NativeStartupDetail = {},
  emit?: (prefix: string, line: string) => void,
): void {
  if (startupMarks.has(phase)) return;
  startupMarks.set(phase, {
    atMs: Math.max(0, Math.round(nativeNow() - startupPerfOrigin)),
    ...safeStartupDetail(detail),
  });
  if (phase === 'home_rendered' || phase === 'recovery_shown') emitStartupSummaryOnce(phase, emit);
}

export function hasStartupPhase(phase: NativeStartupPhase): boolean {
  return startupMarks.has(phase);
}

/** Tests and device tooling only: start a fresh start-up record. */
export function resetNativeStartupMarks(): void {
  startupEpochMs = Date.now();
  startupPerfOrigin = nativeNow();
  startupMarks.clear();
  startupMarks.set('process_start', { atMs: 0 });
  startupSummaryEmitted = false;
}
