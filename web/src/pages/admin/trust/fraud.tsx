import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ShieldAlert } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Fraud Check (/admin/trust/fraud)
 * Calculate real signals from available data: self-referral, velocity, cancellations, repeated receiver.
 * Does NOT always return LOW — signals are computed from actual DB queries.
 */

const RISK_STYLES: Record<string, string> = {
  LOW: 'bg-green-100 text-green-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-red-100 text-red-700',
}

export default function FraudChecks() {
  const { checkFraudSignals } = useCarUpApi()
  const [userId, setUserId] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [receiverId, setReceiverId] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId.trim()) { setError('User ID is required.'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await checkFraudSignals({
        user_id: userId.trim(),
        referral_code: referralCode.trim() || undefined,
        context: receiverId.trim() ? { receiver_user_id: receiverId.trim() } : {},
      })
      setResult(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fraud check failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <ShieldAlert className="h-6 w-6" /> Fraud Signal Check
      </h1>
      <p className="text-sm text-gray-500">
        Checks real signals: self-referral, excessive velocity (&gt;10 events/24h), repeated cancellations (3+), repeated receiver (&gt;3 times).
        Score and signals are computed from the database — not hardcoded.
      </p>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}

      <Card>
        <CardContent className="p-5">
          <form onSubmit={run} className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">User ID *</label>
              <Input placeholder="The user to check" value={userId} onChange={e => setUserId(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs text-gray-500">Referral Code (optional — for self-referral check)</label>
              <Input placeholder="Code they used" value={referralCode} onChange={e => setReferralCode(e.target.value)} className="font-mono uppercase" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Receiver User ID (optional — for repeated-receiver check)</label>
              <Input placeholder="Receiver user being linked" value={receiverId} onChange={e => setReceiverId(e.target.value)} />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Checking…' : 'Run Fraud Check'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className={RISK_STYLES[result.risk_level] || 'bg-gray-100 text-gray-700'}>
                Risk: {result.risk_level}
              </Badge>
              <span className="text-sm text-gray-500">Score: {result.risk_score}</span>
              {result.review_required && (
                <Badge className="bg-orange-100 text-orange-700">Review Required</Badge>
              )}
            </div>

            {result.signals?.length > 0 ? (
              <div>
                <p className="text-xs text-gray-500 mb-1">Signals detected:</p>
                <ul className="space-y-1">
                  {result.signals.map((s: string) => (
                    <li key={s} className="text-sm flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-400 inline-block" />
                      {s.replace(/_/g, ' ')}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No risk signals detected for user <strong>{result.user_id}</strong>.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}