/**
 * RX-06 — one small hook for the extra reads the unified Trade views need (the order switcher, the
 * audit trail, the government footprint, the handoff status, shipment stage events). A read runs only
 * while `enabled`, re-runs when its `key` changes, keeps its last result for the same key, and turns a
 * failure into an honest Read (failed with retry / denied / unavailable) — never into an empty list.
 * The legacy pages never enable it, so their requests are unchanged.
 */
import { useEffect, useRef, useState } from 'react'
import { READ_LOADING, readFromError, readReady, type Read } from './orderModel'

export function useTradeRead<T>(enabled: boolean, key: string | null, fetcher: () => Promise<T>): Read<T> {
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ token: string; read: Read<T> } | null>(null)
  const token = enabled && key ? `${key}#${attempt}` : null

  useEffect(() => {
    if (!token) return
    let active = true
    const retry = () => setAttempt(a => a + 1)
    // Promise.resolve().then: a synchronous throw (e.g. a missing client function) is a failed read too.
    Promise.resolve()
      .then(() => fetcherRef.current())
      .then(
        data => { if (active) setResult({ token, read: readReady(data) }) },
        err => { if (active) setResult({ token, read: readFromError(err, retry) }) },
      )
    return () => { active = false }
  }, [token])

  if (!token) return READ_LOADING
  return result?.token === token ? result.read : READ_LOADING
}
