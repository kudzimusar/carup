import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { CheckCircle, FileText, Image as ImageIcon, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { EvidenceVerificationStatus, VehicleEvidence } from '@/types'

const statuses: EvidenceVerificationStatus[] = ['pending', 'verified', 'rejected']

function labelize(value?: string) {
  return (value || 'evidence')
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export default function EvidenceReview() {
  const { fetchEvidenceReviewQueue, approveEvidence, rejectEvidence } = useCarUpApi()
  const [status, setStatus] = useState<EvidenceVerificationStatus>('pending')
  const [items, setItems] = useState<VehicleEvidence[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    fetchEvidenceReviewQueue(status)
      .then(data => {
        if (mounted) setItems(data)
      })
      .catch(err => toast.error(err instanceof Error ? err.message : 'Failed to load evidence queue'))
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => { mounted = false }
  }, [fetchEvidenceReviewQueue, status])

  const counts = useMemo(() => ({
    total: items.length,
    photos: items.filter(item => item.evidence_type.includes('photo')).length,
    documents: items.filter(item => item.evidence_type.includes('document')).length
  }), [items])

  const review = async (item: VehicleEvidence, action: 'approve' | 'reject') => {
    setBusyId(item.id)
    try {
      const note = notes[item.id] || (action === 'approve' ? 'Evidence matches vehicle registry event.' : 'Evidence rejected during review.')
      if (action === 'approve') {
        await approveEvidence(item.vin, item.id, note, 3)
        toast.success('Evidence approved')
      } else {
        await rejectEvidence(item.vin, item.id, note, -5)
        toast.success('Evidence rejected')
      }
      setItems(current => current.filter(row => row.id !== item.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Evidence review failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Vehicle Evidence Review</h1>
          <p className="text-gray-500">Approve, reject, and inspect visual proof linked to vehicle registry events.</p>
        </div>
        <Tabs value={status} onValueChange={(value) => setStatus(value as EvidenceVerificationStatus)}>
          <TabsList>
            {statuses.map(option => (
              <TabsTrigger key={option} value={option}>{labelize(option)}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { label: 'Queue Items', value: counts.total },
          { label: 'Photos', value: counts.photos },
          { label: 'Documents', value: counts.documents },
        ].map(stat => (
          <Card key={stat.label} className="border-0 card-shadow">
            <CardContent className="p-5">
              <p className="text-sm text-gray-500">{stat.label}</p>
              <p className="text-2xl font-bold mt-1">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 card-shadow">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Evidence Queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="py-12 flex justify-center text-orange-500">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No {status} evidence items</p>
            </div>
          ) : (
            items.map(item => {
              const isDocument = item.evidence_type.includes('document')
              return (
                <div key={item.id} className="grid lg:grid-cols-[180px_1fr] gap-4 rounded-lg border border-gray-100 bg-white p-4">
                  <a href={item.file_url} target="_blank" rel="noopener noreferrer" className="block">
                    {isDocument ? (
                      <div className="h-36 rounded-md bg-gray-50 flex flex-col items-center justify-center text-gray-500 gap-2">
                        <FileText className="w-8 h-8 text-orange-500" />
                        <span className="text-xs font-medium">Open document</span>
                      </div>
                    ) : (
                      <img src={item.file_url} alt={labelize(item.evidence_type)} className="h-36 w-full rounded-md object-cover bg-gray-100" />
                    )}
                  </a>

                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          {isDocument ? <FileText className="w-4 h-4 text-orange-500" /> : <ImageIcon className="w-4 h-4 text-orange-500" />}
                          <h2 className="font-semibold">{labelize(item.evidence_type)}</h2>
                          <Badge variant="outline" className="text-[10px]">{labelize(item.verification_status)}</Badge>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {item.vin} · {labelize(item.uploader_role)} · {new Date(item.uploaded_at).toLocaleString()}
                        </p>
                      </div>
                      <Badge className="bg-gray-100 text-gray-700 border-0 shadow-none w-fit">
                        {item.linked_registry_event_id || 'Unlinked'}
                      </Badge>
                    </div>

                    <div className="grid md:grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-gray-50 px-3 py-2">
                        Event: <span className="font-medium">{labelize(item.event_type)}</span>
                      </div>
                      <div className="rounded-md bg-gray-50 px-3 py-2">
                        Checksum: <span className="font-mono">{(item.checksum || item.image_hash || '').slice(0, 12) || 'missing'}</span>
                      </div>
                      <div className="rounded-md bg-gray-50 px-3 py-2">
                        Trust impact: <span className="font-medium">{item.trust_score_impact}</span>
                      </div>
                    </div>

                    {status === 'pending' && (
                      <div className="space-y-3">
                        <Textarea
                          value={notes[item.id] || ''}
                          onChange={(event) => setNotes(current => ({ ...current, [item.id]: event.target.value }))}
                          placeholder="Review notes"
                          className="min-h-20"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            className="bg-green-600 hover:bg-green-700 gap-2"
                            onClick={() => review(item, 'approve')}
                            disabled={busyId === item.id}
                          >
                            {busyId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => review(item, 'reject')}
                            disabled={busyId === item.id}
                          >
                            <XCircle className="w-4 h-4" />
                            Reject
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
