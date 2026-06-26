import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Users } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Agent/Depot Assisted Leads (/admin/referrals/assisted-leads)
 * Register an assisted lead with scan_context and referral code.
 * Also displays the agent's own lead history.
 */

const SCAN_CONTEXTS = ['agent', 'depot', 'invoice', 'booking', 'pickup'] as const
type ScanContext = typeof SCAN_CONTEXTS[number]

type TradeEvent = {
  id: string
  event_kind: string
  status: string
  referral_code?: string
  metadata: Record<string, unknown>
  created_at: string
}

export default function AgentDepotPage() {
  const { registerAgentLead, getAgentLeads } = useCarUpApi()
  const [leads, setLeads] = useState<TradeEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const [form, setForm] = useState({
    scan_context: 'agent' as ScanContext,
    referral_code: '',
    reference: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getAgentLeads()
      setLeads(res.leads ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [getAgentLeads])

  useEffect(() => { load() }, [load])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSuccessMsg(null)
    setError(null)
    try {
      const res = await registerAgentLead({
        scan_context: form.scan_context,
        referral_code: form.referral_code.trim() || undefined,
        reference: form.reference.trim() || undefined,
      })
      setSuccessMsg('Lead registered. Event ID: ' + res.trade_event?.id)
      setForm({ scan_context: 'agent', referral_code: '', reference: '' })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" /> Agent / Depot Assisted Leads
        </h1>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>
      <p className="text-sm text-gray-500">Register a customer lead you assisted. You cannot approve your own reward — that requires admin action.</p>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}
      {successMsg && <p className="text-sm text-green-600 bg-green-50 p-3 rounded">{successMsg}</p>}

      <Card>
        <CardContent className="p-5">
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">Scan Context *</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.scan_context}
                onChange={e => setForm(f => ({ ...f, scan_context: e.target.value as ScanContext }))}
              >
                {SCAN_CONTEXTS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Referral Code (optional)</label>
              <Input
                placeholder="Code you scanned or customer provided"
                value={form.referral_code}
                onChange={e => setForm(f => ({ ...f, referral_code: e.target.value.toUpperCase() }))}
                className="font-mono uppercase"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Reference</label>
              <Input
                placeholder="Invoice number, booking ID, etc."
                value={form.reference}
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Registering…' : 'Register Assisted Lead'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Your Lead History ({leads.length})</p>
        {leads.length === 0 && !loading && <p className="text-sm text-gray-500">No leads registered yet.</p>}
        {leads.map(lead => (
          <Card key={lead.id}>
            <CardContent className="p-4 flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-sm font-mono text-gray-500">{lead.id}</p>
                <p className="text-xs text-gray-400">
                  Context: {String(lead.metadata?.scan_context || '—')} ·
                  Ref: {String(lead.metadata?.reference || '—')} ·
                  Code: {lead.referral_code || '—'}
                </p>
                <p className="text-xs text-gray-400">{new Date(lead.created_at).toLocaleString()}</p>
              </div>
              <Badge className="bg-gray-100 text-gray-700">{lead.status}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}