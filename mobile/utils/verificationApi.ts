import { OcrResult, VerificationOutcomeStatus } from '../store/verificationStore';
import { resolveApiBaseUrl } from './apiBase';

export interface VerificationSession {
  id: string;
  document_type: string;
  double_sided: boolean;
  status: 'draft' | 'captured' | 'uploaded' | 'ocr_pending' | 'ocr_failed' | 'pending_manual_review' | 'retry_requested' | 'verified' | 'rejected';
  uploaded_sides: {
    front: boolean;
    back: boolean;
    selfie: boolean;
  };
  ocr_document_id: string | null;
  ocr_result: OcrResult | null;
  confidence_score: number | null;
  failure_reason: string | null;
  review_notes: string | null;
  retry_reason: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  ocr_completed_at: string | null;
}

export interface VerificationFlowInput {
  docType: string;
  doubleSided: boolean;
  capturedFront: string;
  capturedBack?: string | null;
  capturedSelfie: string;
}

export interface VerificationOutcome {
  status: VerificationOutcomeStatus;
  sessionId: string | null;
  ocrResult: OcrResult | null;
  processingError: string | null;
  /** Raw backend session status, used for shared status-mapping copy. */
  sessionStatus: VerificationSession['status'] | null;
}

export class VerificationApiError extends Error {
  statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'VerificationApiError';
    this.statusCode = statusCode;
  }
}

export class VerificationApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationApiConfigurationError';
  }
}

/**
 * Canonical base resolver. The core logic now lives in utils/apiBase.ts so every
 * API client shares one validated, localhost-safe resolver. This thin wrapper is
 * kept so existing imports (marketplaceApi, referralApi) keep working, and it
 * re-tags the ApiConfigurationError as a VerificationApiConfigurationError to
 * preserve the original error contract.
 */
export function getVerificationApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
  platformOS?: string
) {
  try {
    return platformOS === undefined ? resolveApiBaseUrl(env) : resolveApiBaseUrl(env, platformOS);
  } catch (error) {
    throw new VerificationApiConfigurationError(
      error instanceof Error ? error.message : 'Failed to resolve the API base URL.'
    );
  }
}

async function authHeaders() {
  const { useAuthStore } = await import('../store/authStore');
  const { token, user } = useAuthStore.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  };

  if (token) {
    headers['x-session-token'] = token;
  }

  if (user?.role) {
    headers['x-stakeholder-role'] = user.role;
  }

  if (!token && user?.id && process.env.EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK === 'true') {
    headers['x-user-id'] = user.id;
  }

  return headers;
}

// The backend's csrfMiddleware requires a signed x-csrf-token on every
// mutating request, bound to the x-session-token it is used with (web's
// apiClient follows the same contract). Cache one token per session.
const CSRF_TOKEN_TTL_MS = 90 * 60 * 1000;
let csrfCache: { sessionKey: string; token: string; fetchedAt: number } | null = null;

export async function fetchCsrfToken(baseUrl: string, sessionToken: string | null): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    // ngrok's free tier serves an HTML warning page to browser-like
    // User-Agents (which RN/Expo Go fetch uses); this documented header
    // bypasses it and is ignored by every other backend.
    'ngrok-skip-browser-warning': 'true',
  };
  if (sessionToken) {
    headers['x-session-token'] = sessionToken;
  }
  const response = await fetch(`${baseUrl}/api/security/csrf-token`, { headers });
  if (!response.ok) {
    throw new VerificationApiError(`Failed to obtain CSRF token (HTTP ${response.status}).`, response.status);
  }
  let body: { csrfToken?: string };
  try {
    body = await response.json();
  } catch {
    throw new VerificationApiError(
      'Security endpoint returned a non-JSON response — a tunnel or proxy may be intercepting requests.',
      response.status
    );
  }
  if (!body?.csrfToken) {
    throw new VerificationApiError('CSRF token missing from security endpoint response.', response.status);
  }
  return body.csrfToken;
}

async function getCsrfToken(baseUrl: string, forceRefresh = false): Promise<string> {
  const { useAuthStore } = await import('../store/authStore');
  const sessionToken = useAuthStore.getState().token;
  const sessionKey = sessionToken || 'none';

  if (
    !forceRefresh &&
    csrfCache &&
    csrfCache.sessionKey === sessionKey &&
    Date.now() - csrfCache.fetchedAt < CSRF_TOKEN_TTL_MS
  ) {
    return csrfCache.token;
  }

  const token = await fetchCsrfToken(baseUrl, sessionToken);
  csrfCache = { sessionKey, token, fetchedAt: Date.now() };
  return token;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getVerificationApiBaseUrl();
  const method = (options.method || 'GET').toUpperCase();

  const performRequest = async (forceCsrfRefresh: boolean) => {
    const headers: Record<string, string> = {
      ...(await authHeaders()),
      ...((options.headers as Record<string, string>) || {}),
    };
    if (MUTATING_METHODS.has(method)) {
      headers['x-csrf-token'] = await getCsrfToken(baseUrl, forceCsrfRefresh);
    }
    return fetch(`${baseUrl}${path}`, { ...options, headers });
  };

  let response = await performRequest(false);

  // A 403 on a mutating request usually means the cached CSRF token went
  // stale (expired or session changed) — refresh it once and retry.
  if (response.status === 403 && MUTATING_METHODS.has(method)) {
    response = await performRequest(true);
  }

  if (!response.ok) {
    let message = `Verification API returned HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message || body?.error || message;
    } catch {
      // Keep the status-based message when the response body is not JSON.
    }
    throw new VerificationApiError(message, response.status);
  }

  return response.json();
}

export async function createVerificationSession(docType: string, doubleSided: boolean) {
  const body = JSON.stringify({
    documentType: docType,
    doubleSided,
  });
  const response = await requestJson<{ success: boolean; session: VerificationSession }>('/api/identity/verification-sessions', {
    method: 'POST',
    body,
  });
  return response.session;
}

export async function uploadVerificationImage(sessionId: string, side: 'front' | 'back' | 'selfie', image: string) {
  const response = await requestJson<{ success: boolean; session: VerificationSession }>(
    `/api/identity/verification-sessions/${sessionId}/upload/${side}`,
    {
      method: 'POST',
      body: JSON.stringify({ image }),
    }
  );
  return response.session;
}

export async function submitVerificationSession(sessionId: string) {
  const response = await requestJson<{ success: boolean; session: VerificationSession }>(
    `/api/identity/verification-sessions/${sessionId}/submit`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
  return response.session;
}

/**
 * Re-fetch a session so the result screen can reflect an admin decision
 * (verified / rejected / retry_requested) after manual review. The backend
 * remains the source of truth — the mobile app never invents a status.
 */
/**
 * ENTRY PREFLIGHT: the authenticated applicant's most recent session, or null
 * when they have none. Lets the flow stop a terminally-rejected applicant
 * BEFORE document selection or camera capture.
 */
export async function getLatestVerificationSession(): Promise<VerificationSession | null> {
  const response = await requestJson<{ success: boolean; session: VerificationSession | null }>(
    '/api/identity/verification-sessions/latest',
    { method: 'GET' }
  );
  return response.session ?? null;
}

export async function getVerificationSession(sessionId: string) {
  const response = await requestJson<{ success: boolean; session: VerificationSession }>(
    `/api/identity/verification-sessions/${sessionId}`,
    { method: 'GET' }
  );
  return response.session;
}

export function mapSessionToVerificationOutcome(session: VerificationSession): VerificationOutcome {
  if (session.status === 'verified') {
    return {
      status: 'verified',
      sessionId: session.id,
      ocrResult: session.ocr_result,
      processingError: null,
      sessionStatus: session.status,
    };
  }

  if (session.status === 'ocr_failed') {
    return {
      status: 'ocr_failed',
      sessionId: session.id,
      ocrResult: session.ocr_result,
      processingError: session.failure_reason || 'OCR could not complete. A reviewer may need to inspect the capture.',
      sessionStatus: session.status,
    };
  }

  if (session.status === 'pending_manual_review') {
    return {
      status: 'needs_review',
      sessionId: session.id,
      ocrResult: session.ocr_result,
      processingError: session.review_notes || session.failure_reason || 'Verification needs manual review before it can be marked verified.',
      sessionStatus: session.status,
    };
  }

  if (session.status === 'retry_requested') {
    return {
      status: 'retry_requested',
      sessionId: session.id,
      ocrResult: session.ocr_result,
      processingError: session.retry_reason || session.review_notes || 'A reviewer asked you to retake and resubmit your verification.',
      sessionStatus: session.status,
    };
  }

  if (session.status === 'rejected') {
    return {
      status: 'rejected',
      sessionId: session.id,
      ocrResult: session.ocr_result,
      processingError: session.review_notes || session.failure_reason || 'Verification was rejected.',
      sessionStatus: session.status,
    };
  }

  return {
    status: 'needs_review',
    sessionId: session.id,
    ocrResult: session.ocr_result,
    processingError: 'Verification was captured and is still being processed.',
    sessionStatus: session.status,
  };
}

export async function runVerificationSessionFlow(input: VerificationFlowInput): Promise<VerificationOutcome> {
  const session = await createVerificationSession(input.docType, input.doubleSided);
  let latest = await uploadVerificationImage(session.id, 'front', input.capturedFront);

  if (input.doubleSided && input.capturedBack) {
    latest = await uploadVerificationImage(session.id, 'back', input.capturedBack);
  }

  latest = await uploadVerificationImage(session.id, 'selfie', input.capturedSelfie);
  latest = await submitVerificationSession(latest.id);

  return mapSessionToVerificationOutcome(latest);
}
