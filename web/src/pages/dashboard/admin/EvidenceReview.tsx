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

                    {/* AI Assisted Analysis Section */}
                    {item.metadata?.ai_analysis && (
                      <div className="rounded-lg border border-orange-100 bg-orange-50/20 p-3.5 space-y-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-orange-100/50 pb-2">
                          <div className="flex items-center gap-1.5 font-semibold text-orange-950">
                            <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                            AI Copilot Fraud Scan
                          </div>
                          <div className="flex gap-2">
                            <Badge className={`border-0 ${
                              item.metadata.ai_analysis.ai_status === 'ai_passed' ? 'bg-green-100 text-green-700 hover:bg-green-100' :
                              item.metadata.ai_analysis.ai_status === 'ai_flagged' ? 'bg-red-100 text-red-700 font-bold hover:bg-red-100' :
                              item.metadata.ai_analysis.ai_status === 'ai_low_confidence' ? 'bg-amber-100 text-amber-700 hover:bg-amber-100' :
                              'bg-gray-100 text-gray-700 hover:bg-gray-100'
                            }`}>
                              {labelize(item.metadata.ai_analysis.ai_status)}
                            </Badge>
                            <Badge className="bg-orange-100 text-orange-850 hover:bg-orange-100 border-0 font-normal">
                              Confidence: {Math.round(item.metadata.ai_analysis.confidence * 100)}%
                            </Badge>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-gray-700">
                            <strong className="text-gray-900 font-medium font-sans">Summary:</strong>
                            {" "}{item.metadata.ai_analysis.reviewer_summary}
                          </p>

                          {/* Data Extraction & Mismatch Alert */}
                          {(item.metadata.ai_analysis.visible_vin || item.metadata.ai_analysis.visible_plate || item.metadata.ai_analysis.visible_odometer) && (
                            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                              {item.metadata.ai_analysis.visible_vin && (
                                <div className={`px-2.5 py-1.5 rounded border ${
                                  item.metadata.ai_analysis.visible_vin !== item.vin
                                    ? 'bg-red-50/50 border-red-200 text-red-800'
                                    : 'bg-green-50/30 border-green-200 text-green-800'
                                }`}>
                                  Visible VIN: <span className="font-mono font-bold">{item.metadata.ai_analysis.visible_vin}</span>
                                  {item.metadata.ai_analysis.visible_vin !== item.vin && (
                                    <span className="block text-[10px] text-red-500 font-medium mt-0.5">⚠️ Mismatch with vehicle VIN</span>
                                  )}
                                </div>
                              )}
                              {item.metadata.ai_analysis.visible_plate && (
                                <div className="px-2.5 py-1.5 rounded border bg-gray-50 border-gray-200 text-gray-800">
                                  Visible Plate: <span className="font-bold">{item.metadata.ai_analysis.visible_plate}</span>
                                </div>
                              )}
                              {item.metadata.ai_analysis.visible_odometer && (
                                <div className="px-2.5 py-1.5 rounded border bg-gray-50 border-gray-200 text-gray-800">
                                  Odometer: <span className="font-bold">{Number(item.metadata.ai_analysis.visible_odometer).toLocaleString()} km</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Indicators */}
                          {item.metadata.ai_analysis.damage_indicators && item.metadata.ai_analysis.damage_indicators.length > 0 && (
                            <div className="pt-1">
                              <span className="font-semibold text-gray-900">Damage Indicators: </span>
                              {item.metadata.ai_analysis.damage_indicators.map((d: any, idx: number) => (
                                <span key={idx} className="inline-block bg-orange-100/50 text-orange-900 px-2 py-0.5 rounded mr-1">
                                  {d.type} ({d.severity}) {d.location && `@ ${d.location}`}
                                </span>
                              ))}
                            </div>
                          )}

                          {item.metadata.ai_analysis.manipulation_indicators && item.metadata.ai_analysis.manipulation_indicators.length > 0 && (
                            <div className="pt-1 text-red-800">
                              <span className="font-semibold">Manipulation Indicators: </span>
                              {item.metadata.ai_analysis.manipulation_indicators.map((m: any, idx: number) => (
                                <span key={idx} className="inline-block bg-red-100/50 px-2 py-0.5 rounded mr-1 font-medium">
                                  {m.type} ({m.severity})
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Recommended Action */}
                          <div className="pt-1 flex items-center gap-1.5">
                            <span className="font-semibold text-gray-900">Recommended Action: </span>
                            <span className={`font-bold capitalize ${
                              item.metadata.ai_analysis.recommended_action === 'approve' ? 'text-green-700' :
                              item.metadata.ai_analysis.recommended_action === 'reject' ? 'text-red-700' :
                              'text-amber-700'
                            }`}>
                              {item.metadata.ai_analysis.recommended_action}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {item.verification_notes && (
                      <p className="text-xs text-gray-700 bg-gray-50 p-2.5 rounded-md italic border border-gray-100">
                        "{item.verification_notes}"
                      </p>
                    )}

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
