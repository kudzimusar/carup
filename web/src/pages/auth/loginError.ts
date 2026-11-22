// Safe, user-readable login failure classification.
//
// Login failures must be reported to the user without leaking which field was
// wrong and without exposing server internals. We collapse every failure into
// one of three safe categories, each with a distinct, readable message.

export type LoginErrorKind =
  | 'invalid_credentials' // bad email/phone or password (auth rejected)
  | 'backend_unavailable' // request never reached the server (network/offline)
  | 'server_error' // server/session failure (5xx, unparseable response)
  | 'throttled' // 429: CarUp's shared request limit for this connection — not a server fault, not a credential problem

export interface LoginErrorState {
  kind: LoginErrorKind
  message: string
}

export const LOGIN_ERROR_MESSAGES: Record<LoginErrorKind, string> = {
  // Deliberately does not reveal whether the email/phone or the password was
  // the wrong one — that distinction would aid credential enumeration.
  invalid_credentials:
    'Invalid email/phone or password. Please check your details and try again.',
  backend_unavailable:
    'CarUp is unreachable right now. Check your connection and try again.',
  server_error:
    'Something went wrong on our end. Please try again in a moment.',
  throttled:
    'CarUp is receiving too many requests from this connection right now. Wait a minute, then sign in again.',
}

export function loginError(kind: LoginErrorKind): LoginErrorState {
  return { kind, message: LOGIN_ERROR_MESSAGES[kind] }
}

// Map a non-OK HTTP login response status to a safe error kind.
// 4xx auth rejections (400/401/403) are invalid credentials; everything else
// (5xx, unexpected statuses) is treated as a server/session failure.
export function classifyLoginStatus(status: number): LoginErrorKind {
  if (status === 400 || status === 401 || status === 403) {
    return 'invalid_credentials'
  }
  // RX06-LR04 (LR04-F06): a throttled request is neither a server fault nor a wrong password.
  if (status === 429) return 'throttled'
  return 'server_error'
}
