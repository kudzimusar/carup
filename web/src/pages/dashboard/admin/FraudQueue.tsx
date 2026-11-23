import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ShieldAlert, CheckCircle, XCircle } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errorMessage'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { ReadFailedNotice } from '@/components/workbench/ReadFailedNotice'
import { CHIP, isReadRefusal, normalizedStatus, recordedDate, type ChipTone, type RecordReadState } from '@/components/workbench/institutionalRecords'

export interface FraudCase {
  id: string
  vin: string
  status: string
  highest_severity: string
  open_signal_count?: number
  blocks_publication?: boolean
  created_at: string
}

const SEV_COLORS: Record<string, string> = {
  critical: 'bg-red-600 text-white', high: 'bg-orange-500 text-white',
  medium: 'bg-amber-400 text-amber-900', low: 'bg-gray-300 text-gray-700',
}

type FraudCaseCardProps = { fraudCase: FraudCase; onResolve: (id: string, resolution: string) => void; busy: boolean }

export function FraudCaseCard({ fraudCase, onResolve, busy }: FraudCaseCardProps) {
  if (isUnifiedUiEnabled()) return <UnifiedFraudCaseCard fraudCase={fraudCase} onResolve={onResolve} busy={busy} />
  return (
    <Card className="border-0 card-shadow" data-testid="fraud-case-card">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-500" />
              <span className="font-medium">VIN {fraudCase.vin}</span>
              <Badge className={SEV_COLORS[fraudCase.highest_severity] || 'bg-gray-200'}>{fraudCase.highest_severity}</Badge>
              {fraudCase.blocks_publication && <Badge variant="outline" className="border-red-300 text-red-700">blocks publication</Badge>}
            </div>
            <p className="text-xs text-gray-500 mt-1">{fraudCase.open_signal_count ?? 0} signal(s) · {fraudCase.status} · {new Date(fraudCase.created_at).toLocaleDateString()}</p>
          </div>
          {fraudCase.status === 'open' || fraudCase.status === 'investigating' ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onResolve(fraudCase.id, 'false_positive')}>
                <CheckCircle className="w-3.5 h-3.5 mr-1" /> False positive
              </Button>
              <Button size="sm" variant="outline" className="border-red-300 text-red-700" disabled={busy} onClick={() => onResolve(fraudCase.id, 'blocked')}>
                <XCircle className="w-3.5 h-3.5 mr-1" /> Block listing
              </Button>
            </div>
          ) : <Badge variant="secondary">{fraudCase.status}</Badge>}
        </div>
      </CardContent>
    </Card>
  )
}

// RX06-LR07 (unified only): the recorded severity on an AA chip (the legacy white-on-orange "high" measured 2.8:1).
const SEVERITY_TONE: Record<string, ChipTone> = { critical: 'negative', high: 'negative', medium: 'pending', low: 'neutral' }
const chip = (tone: ChipTone) => `inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP[tone]}`

/**
 * RX06-LR07 (unified only) — the same case, laid out for a phone. The VIN wraps (D6 HOLD: shown exactly as the legacy
 * card shows it), the recorded fields are LR06's, and the two resolutions are the SAME buttons — same labels, same
 * onResolve values, same disabled rule — stacked under the case on a phone instead of pushing the page to 660 px.
 */
function UnifiedFraudCaseCard({ fraudCase, onResolve, busy }: FraudCaseCardProps) {
  const severity = typeof fraudCase.highest_severity === 'string' && fraudCase.highest_severity.trim() ? fraudCase.highest_severity : null
  return (
    <Card className="border-0 card-shadow" data-testid="fraud-case-card">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              <span className="min-w-0 break-all font-medium">VIN {fraudCase.vin}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className={chip(severity ? SEVERITY_TONE[normalizedStatus(severity)] ?? 'neutral' : 'neutral')} data-testid="fraud-case-severity">{severity ?? 'Severity not recorded'}</span>
              {fraudCase.blocks_publication && <span className={chip('negative')}>blocks publication</span>}
            </div>
            {/* RX06-LR06 U10-S1: an unrecorded signal count or date is said so, never shown as 0 / "Invalid Date". */}
            <p className="mt-1.5 text-xs text-gray-600" data-testid="fraud-case-recorded-fields">
              {typeof fraudCase.open_signal_count === 'number' ? `${fraudCase.open_signal_count} signal(s)` : 'Signal count not recorded'} · {fraudCase.status || 'Status not recorded'} · {recordedDate(fraudCase.created_at) ?? 'Date not recorded'}
            </p>
          </div>
          {fraudCase.status === 'open' || fraudCase.status === 'investigating' ? (
            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:shrink-0" data-testid="fraud-case-actions">
              <Button size="sm" variant="outline" className="h-11 sm:h-8" disabled={busy} onClick={() => onResolve(fraudCase.id, 'false_positive')}>
                <CheckCircle className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> False positive
              </Button>
              <Button size="sm" variant="outline" className="h-11 border-red-300 text-red-700 sm:h-8" disabled={busy} onClick={() => onResolve(fraudCase.id, 'blocked')}>
                <XCircle className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Block listing
              </Button>
            </div>
          ) : <span className={chip('neutral')}>{fraudCase.status || 'Status not recorded'}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

export default function FraudQueue() {
  const { fetchFraudCases, resolveFraudCase } = useCarUpApi()
  const [cases, setCases] = useState<FraudCase[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const unified = isUnifiedUiEnabled()
  const [readState, setReadState] = useState<RecordReadState>('loading')
  const [readRefused, setReadRefused] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetchFraudCases({ status: 'open' }); setCases((r.cases || []) as FraudCase[]); setReadState('ready') }
    catch (err) { toast.error(getErrorMessage(err)); setReadState('failed'); setReadRefused(isReadRefusal(err)) }
    finally { setLoading(false) }
  }, [fetchFraudCases])

  // Initial load: fetch without a synchronous set-state-in-effect (loading starts true;
  // state is set only in the async continuation). load() is reused for event-driven refresh.
  useEffect(() => {
    let cancelled = false
    fetchFraudCases({ status: 'open' })
      .then((r) => { if (!cancelled) { setCases((r.cases || []) as FraudCase[]); setReadState('ready') } })
      .catch((err) => { if (!cancelled) { toast.error(getErrorMessage(err)); setReadState('failed'); setReadRefused(isReadRefusal(err)) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchFraudCases])

  const onResolve = async (id: string, resolution: string) => {
    setBusy(id)
    try {
      await resolveFraudCase(id, { resolution, reason: `Admin marked ${resolution}` })
      toast.success(`Case ${resolution.replace(/_/g, ' ')}`)
      await load()
    } catch (err) { toast.error(getErrorMessage(err)) }
    finally { setBusy(null) }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldAlert className="w-6 h-6 text-red-500" /> Fraud &amp; duplicate queue</h1>
        <p className="text-gray-500 text-sm">Open cases from the duplicate/fraud engine. Resolving records an append-only decision; vehicle passports are never auto-merged.</p>
      </div>
      {loading ? [1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)
        : unified && readState === 'failed' ? <ReadFailedNotice subject="open fraud cases" refused={readRefused} onRetry={() => void load()} testId="fraud-cases-read-failed" />
        : cases.length === 0 ? <Card className="border-0 card-shadow"><CardContent className={`py-10 text-center ${unified ? 'text-gray-600' : 'text-gray-400'}`}>No open fraud cases.</CardContent></Card>
        : cases.map(c => <FraudCaseCard key={c.id} fraudCase={c} onResolve={onResolve} busy={busy === c.id} />)}
    </div>
  )
}
