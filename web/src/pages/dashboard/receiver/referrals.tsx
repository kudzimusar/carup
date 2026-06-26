import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, UserCheck, PackageCheck } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Receiver Dashboard (/dashboard/receiver/referrals)
 * View payer→receiver links, accept invitation, confirm handover, track status.
 */

type Link = {
  id: string
  payer_user_id: string
  receiver_name?: string
  receiver_phone?: string
  receiver_location?: string
  reference?: string
  acceptance_status: string
  handover_status: string
  subject_type?: string
  subject_id?: string
  created_at: string
}

function statusClass(s: string) {
  const map: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    accepted: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    confirmed: 'bg-emerald-100 text-emerald-700',
    disputed: 'bg-orange-100 text-orange-700',
  }
  return map[s] || 'bg-gray-100 text-gray-700'
}

function LinkRow({ link, onHandover }: { link: Link; onHandover: () => void }) {
  const { confirmReceiverHandover } = useCarUpApi()
  const [working, setWorking] = useState(false)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const confirm = async (status: 'confirmed' | 'disputed') => {
    setWorking(true)
    setMsg(null)
    try {
      await confirmReceiverHandover(link.id, { handover_status: status, note })
      setMsg(`Handover ${status}.`)
      onHandover()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="font-medium text-sm">{link.receiver_name || 'Receiver Link'}</p>
            <p className="text-xs text-gray-500">Payer: {link.payer_user_id} · Ref: {link.reference || '—'}</p>
            <p className="text-xs text-gray-400">{new Date(link.created_at).toLocaleDateString()}</p>
          </div>
          <div className="flex gap-1 flex-wrap">
            <Badge className={statusClass(link.acceptance_status)}>Accept: {link.acceptance_status}</Badge>
            <Badge className={statusClass(link.handover_status)}>Handover: {link.handover_status}</Badge>
          </div>
        </div>

        {link.handover_status === 'pending' && (
          <div className="space-y-2 pt-2 border-t">
            <Input
              placeholder="Handover note (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => confirm('confirmed')} disabled={working}>
                <PackageCheck className="h-4 w-4 mr-1" /> Confirm Handover
              </Button>
              <Button size="sm" variant="outline" onClick={() => confirm('disputed')} disabled={working}>
                Dispute
              </Button>
            </div>
          </div>
        )}
        {msg && <p className="text-xs text-blue-600">{msg}</p>}
      </CardContent>
    </Card>
  )
}

export default function ReceiverDashboard() {
  const { getMobileReceiverStatus, registerReceiver } = useCarUpApi()
  const [links, setLinks] = useState<Link[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ receiver_name: '', receiver_phone: '', receiver_location: '', reference: '' })
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getMobileReceiverStatus()
      setLinks(res.links ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [getMobileReceiverStatus])

  useEffect(() => { load() }, [load])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSuccessMsg(null)
    setError(null)
    try {
      await registerReceiver({ ...form })
      setSuccessMsg('Receiver link registered.')
      setForm({ receiver_name: '', receiver_phone: '', receiver_location: '', reference: '' })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Receiver Dashboard</h1>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}
      {successMsg && <p className="text-sm text-green-600 bg-green-50 p-3 rounded">{successMsg}</p>}

      {/* Register receiver form */}
      <Card>
        <CardContent className="p-5">
          <p className="font-medium mb-3 flex items-center gap-2"><UserCheck className="h-4 w-4" /> Register Receiver Link</p>
          <form onSubmit={submit} className="space-y-2">
            {[
              { key: 'receiver_name', label: 'Receiver Name', placeholder: 'Full name' },
              { key: 'receiver_phone', label: 'Phone', placeholder: '+263...' },
              { key: 'receiver_location', label: 'Location', placeholder: 'City / District' },
              { key: 'reference', label: 'Reference', placeholder: 'Order or booking ref' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-xs text-gray-500">{label}</label>
                <Input
                  placeholder={placeholder}
                  value={(form as any)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Submitting…' : 'Register Receiver'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Existing links */}
      <div className="space-y-3">
        {links.length === 0 && !loading && <p className="text-sm text-gray-500">No receiver links yet.</p>}
        {links.map(link => (
          <LinkRow key={link.id} link={link} onHandover={load} />
        ))}
      </div>
    </div>
  )
}