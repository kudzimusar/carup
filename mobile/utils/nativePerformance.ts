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
