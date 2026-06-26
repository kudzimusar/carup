import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Star, RefreshCw, Copy, Share2, CheckCircle2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { UniversalReferralWidget } from '@/components/referral/UniversalReferralWidget'

/**
 * Ambassador Dashboard (/dashboard/ambassador/referrals)
 * Activate ambassador profile, view permanent code + QR, see campaigns/leads/rewards/tier.
 * Every call goes through useCarUpApi — no admin actions, no direct DB writes.
 */

type Profile = { profile_type: string; status: string; tier: string; metadata: Record<string, unknown> }
type Code = { code: string; id: string; status: string; is_permanent: boolean }
type Summary = { profile: Profile | null; permanent_code: Code | null; leads: number; conversions: number; pending_rewards: number; approved_rewards: number; tier: string }

function tierBadge(tier = 'starter') {
  const map: Record<string, string> = { starter: 'bg-gray-100 text-gray-700', growth: 'bg-blue-100 text-blue-700', pro: 'bg-purple-100 text-purple-700' }
  return map[tier] || map.starter
}

export default function AmbassadorDashboard() {
  const { activateAmbassador, getMobileAmbassadorSummary, createReferralChannelShareKit } = useCarUpApi()
  const { user } = useAuth()

  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [activating, setActivating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareLink, setShareLink] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getMobileAmbassadorSummary()
      setSummary(res.ambassador ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load summary')
    } finally {
      setLoading(false)
    }
  }, [getMobileAmbassadorSummary])

  useEffect(() => { load() }, [load])

  const activate = async () => {
    setActivating(true)
    setError(null)
    try {
      await activateAmbassador({ tier: 'starter' })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Activation failed')
    } finally {
      setActivating(false)
    }
  }

  const copyCode = () => {
    if (!summary?.permanent_code?.code) return
    navigator.clipboard.writeText(summary.permanent_code.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const buildShareLink = async () => {
    if (!summary?.permanent_code?.code) return
    try {
      const res = await createReferralChannelShareKit({ code: summary.permanent_code.code, channel: 'web' })
      setShareLink((res as any)?.asset?.payload?.referral_link || null)
    } catch { /* ignore */ }
  }

  const notActivated = !summary?.profile || summary.profile.status !== 'active'

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Ambassador Dashboard</h1>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}

      {notActivated ? (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-gray-600">You are not yet activated as an Ambassador.</p>
            <Button onClick={activate} disabled={activating}>
              {activating ? 'Activating…' : 'Activate Ambassador Profile'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Tier + Status */}
          <Card>
            <CardContent className="p-5 flex items-center gap-4">
              <Star className="h-8 w-8 text-amber-400" />
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge className={tierBadge(summary?.tier)}>Tier: {summary?.tier || 'starter'}</Badge>
                  <Badge className="bg-green-100 text-green-700">Active</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Leads', value: summary?.leads ?? 0 },
              { label: 'Conversions', value: summary?.conversions ?? 0 },
              { label: 'Pending Rewards', value: `$${(summary?.pending_rewards ?? 0).toLocaleString()}` },
              { label: 'Approved Rewards', value: `$${(summary?.approved_rewards ?? 0).toLocaleString()}` },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-xl font-semibold mt-1">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Permanent code */}
          {summary?.permanent_code && (
            <Card>
              <CardContent className="p-5 space-y-3">
                <p className="font-medium">Your Referral Code</p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={summary.permanent_code.code} className="font-mono text-lg tracking-widest" />
                  <Button variant="outline" size="sm" onClick={copyCode}>
                    {copied ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>

                {/* UniversalReferralWidget provides QR + multi-channel share */}
                <UniversalReferralWidget code={summary.permanent_code.code} />

                <Button variant="outline" size="sm" onClick={buildShareLink} className="w-full">
                  <Share2 className="h-4 w-4 mr-2" /> Generate Share Link
                </Button>
                {shareLink && (
                  <p className="text-xs text-blue-600 break-all">{shareLink}</p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}