import { useEffect, useState } from 'react'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import { readCommunicationCapability, UNKNOWN_CAPABILITY } from '@/lib/communicationChannels'

export function useCommunicationCapability() {
  const [capability, setCapability] = useState(UNKNOWN_CAPABILITY)
  useEffect(() => {
    const controller = new AbortController()
    const base = resolveApiBaseUrl(import.meta.env.VITE_API_URL, window.location.hostname)
    const timeout = setTimeout(() => controller.abort(), 8000)
    fetch(`${base}/health`, { signal: controller.signal, cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(health => { if (!controller.signal.aborted) setCapability(readCommunicationCapability(health)) })
      .catch(() => { /* Unknown stays explicit; no positive availability on failure. */ })
      .finally(() => clearTimeout(timeout))
    return () => { controller.abort(); clearTimeout(timeout) }
  }, [])
  return capability
}
