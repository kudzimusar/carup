/**
 * CA-OWNER-02-R3 (D1) — holds the shell's management read status for ONE session (the shell keys it on the session, so a
 * different account or a new sign-in starts empty).
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ManagementReadStatusContext, readRecordOf, type AttentionRecord, type ManagementReadRecord } from '@/lib/corporate/managementReadStatus'
import type { ManagementArea, ManagementPayload } from '@/lib/corporate/management'

export function ManagementReadStatusProvider({ children }: { children: ReactNode }) {
  const [latest, setLatest] = useState<ManagementReadRecord | null>(null)
  const [failed, setFailed] = useState(false)
  const [attention, setAttention] = useState<AttentionRecord | null>(null)

  const report = useCallback((area: ManagementArea, payload: ManagementPayload) => {
    setLatest(readRecordOf(area, payload))
    setFailed(false)
    if (payload.area === 'overview') {
      setAttention({ count: payload.attention.length, titles: payload.attention.slice(0, 3).map((i) => i.title), generatedAt: payload.generatedAt })
    }
  }, [])
  const reportFailure = useCallback(() => { setFailed(true) }, [])

  const value = useMemo(() => ({ latest, failed, attention, report, reportFailure }), [latest, failed, attention, report, reportFailure])
  return <ManagementReadStatusContext.Provider value={value}>{children}</ManagementReadStatusContext.Provider>
}
