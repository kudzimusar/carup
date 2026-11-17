import { useEffect, useState } from 'react'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'
import type { DealerQueueInput, ReadStatus } from './dealerActionQueue'

const API = resolveApiBaseUrl(import.meta.env.VITE_API_URL, typeof window === 'undefined' ? undefined : window.location.hostname)

type Enquiries = DealerQueueInput['enquiries']
type Staff = DealerQueueInput['staff']

/**
 * RX05-B — the two extra reads Dealer Today needs for its Action Queue (the inbox and staff), using
 * the SAME endpoints the Enquiries and Staff pages already call with this session's headers. A read
 * for another tenant is discarded (never mixed in). Disabled → nothing is fetched.
 */
export function useDealerTodaySignals({ enabled, userId, token, tenantId, revision }: {
  enabled: boolean
  userId: string | null | undefined
  token: string | null | undefined
  tenantId: string | null | undefined
  revision: number
}): { enquiries: Enquiries; staff: Staff } {
  const [enquiries, setEnquiries] = useState<Enquiries>({ status: 'loading', entries: [] })
  const [staff, setStaff] = useState<Staff>({ status: 'loading', invitations: [] })

  useEffect(() => {
    if (!enabled || !userId || !token || !tenantId) return
    let live = true
    const authHeaders: AuthHeaders = { 'x-session-token': token, 'x-user-id': userId }
    void Promise.resolve().then(() => {
      if (!live) return
      setEnquiries({ status: 'loading', entries: [] })
      setStaff({ status: 'loading', invitations: [] })
    })
    const fail = (status: ReadStatus = 'unavailable') => status
    apiRequest<{ inquiries: { tenant_id: string; entries: Enquiries['entries'] } }>({ baseUrl: API, path: '/dealer/operational-inquiries', authHeaders })
      .then(r => {
        if (!live) return
        const box = r.inquiries
        if (box && box.tenant_id === tenantId && Array.isArray(box.entries)) setEnquiries({ status: 'ready', entries: box.entries })
        else setEnquiries({ status: fail(), entries: [] })
      })
      .catch(() => { if (live) setEnquiries({ status: fail(), entries: [] }) })
    apiRequest<{ staff: { tenant_id: string; invitations: Staff['invitations'] } }>({ baseUrl: API, path: '/dealer/operational-staff', authHeaders })
      .then(r => {
        if (!live) return
        const s = r.staff
        if (s && s.tenant_id === tenantId && Array.isArray(s.invitations)) setStaff({ status: 'ready', invitations: s.invitations })
        else setStaff({ status: fail(), invitations: [] })
      })
      .catch(() => { if (live) setStaff({ status: fail(), invitations: [] }) })
    return () => { live = false }
  }, [enabled, userId, token, tenantId, revision])

  return { enquiries, staff }
}
