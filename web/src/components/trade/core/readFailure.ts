/**
 * RX06-LR04 — how a read that never got an answer, or was throttled, is worded (shared by the order views and the
 * Trade desks). A request that never reached CarUp is not an outage of the record, and a throttled request is not a
 * refusal: each says what happened and that nothing was loaded or changed.
 */

export const OFFLINE_TEXT =
  'CarUp could not be reached from this device. Check the connection, then try again — nothing was loaded or changed.'

export const THROTTLED_TEXT =
  'CarUp is receiving too many requests from this connection right now. Wait a minute, then try again — nothing was loaded or changed.'

// Browser and fetch wording for a request that got no HTTP answer at all (Chrome, Firefox, Safari, node fetch).
// A dynamic-import chunk failure ("Failed to fetch dynamically imported module") is a different event, handled by
// the route loader, and is excluded here.
const NETWORK_FAILURE = /failed to fetch(?! dynamically)|networkerror|network request failed|load failed|network error|err_internet_disconnected|err_network_changed/i

/** True for a request that never got an HTTP answer: no status, and the browser's network-failure wording. */
export function isNetworkFailure(status: number | null | undefined, message: string | null | undefined): boolean {
  return (status === null || status === undefined) && NETWORK_FAILURE.test(String(message ?? ''))
}
