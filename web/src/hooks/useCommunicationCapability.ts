import { useEffect, useState } from 'react'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import { type CommunicationCapability, readCommunicationCapability, UNKNOWN_CAPABILITY } from '@/lib/communicationChannels'

const HEALTH_TIMEOUT_MS = 8000
const CACHE_MS = 30_000

// One health read serves every channel surface on the page (Contact block, inquiry dialogs,
// listing actions). A failed read is never cached, so the next surface asks again.
let cached: { base: string; at: number; promise: Promise<CommunicationCapability> } | null = null

export function resetCommunicationCapabilityCache() {
  cached = null
}

function readCapability(base: string): Promise<CommunicationCapability> {
  const now = Date.now()
  if (cached && cached.base === base && now - cached.at < CACHE_MS) return cached.promise
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  const promise = fetch(`${base}/health`, { signal: controller.signal, cache: 'no-store' })
    .then(response => (response.ok ? response.json() : null))
    .then(health => readCommunicationCapability(health))
    // Unknown stays explicit; no positive availability on failure.
    .catch(() => UNKNOWN_CAPABILITY)
    .finally(() => clearTimeout(timeout))
  const entry = { base, at: now, promise }
  cached = entry
  promise.then(capability => { if (capability.unknown && cached === entry) cached = null })
  return promise
}

export function useCommunicationCapabilityState(): { capability: CommunicationCapability; checking: boolean } {
  const [state, setState] = useState({ capability: UNKNOWN_CAPABILITY, checking: true })
  useEffect(() => {
    let live = true
    const base = resolveApiBaseUrl(import.meta.env.VITE_API_URL, typeof window !== 'undefined' ? window.location.hostname : undefined)
    readCapability(base).then(capability => { if (live) setState({ capability, checking: false }) })
    return () => { live = false }
  }, [])
  return state
}

export function useCommunicationCapability() {
  return useCommunicationCapabilityState().capability
}
