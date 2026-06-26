import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ShieldAlert, CheckCircle, XCircle } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errorMessage'

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

export function FraudCaseCard({ fraudCase, onResolve, busy }: { fraudCase: FraudCase; onResolve: (id: string, resolution: string) => void; busy: boolean }) {
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

export default function FraudQueue() {
  const { fetchFraudCases, resolveFraudCase } = useCarUpApi()
  const [cases, setCases] = useState<FraudCase[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetchFraudCases({ status: 'open' }); setCases(r.cases || []) }
    catch (err) { toast.error(getErrorMessage(err)) }
    finally { setLoading(false) }
  }, [fetchFraudCases])

  useEffect(() => { load() }, [load])

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
        : cases.length === 0 ? <Card className="border-0 card-shadow"><CardContent className="py-10 text-center text-gray-400">No open fraud cases.</CardContent></Card>
        : cases.map(c => <FraudCaseCard key={c.id} fraudCase={c} onResolve={onResolve} busy={busy === c.id} />)}
    </div>
  )
}
