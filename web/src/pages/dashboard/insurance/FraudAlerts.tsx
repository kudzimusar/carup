import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Eye, CheckCircle, Clock, Car } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { FraudAlert } from '@/types'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { ReadFailedNotice } from '@/components/workbench/ReadFailedNotice'
import { CHIP, isReadRefusal, normalizedStatus, recordedDate, type RecordReadState } from '@/components/workbench/institutionalRecords'

/** The columns the fraud-alert read actually returns (fraud_alerts): "Open"/"Resolved", "High"/"Medium"/"Low". */
type RecordedFraudAlert = FraudAlert & { alert_type?: string | null; created_at?: string | null; resolved_at?: string | null }

export default function FraudAlerts() {
  const { fetchFraudAlerts, resolveFraudAlert } = useCarUpApi()
  const [alerts, setAlerts] = useState<FraudAlert[]>([])
  const [loading, setLoading] = useState(true)
  const unified = isUnifiedUiEnabled()
  const [readState, setReadState] = useState<RecordReadState>('loading')
  const [readRefused, setReadRefused] = useState(false)

  useEffect(() => {
    loadAlerts()
  }, [])

  const loadAlerts = async () => {
    try {
      setLoading(true)
      setReadState('loading')
      const data = await fetchFraudAlerts()
      setAlerts(data || [])
      setReadState('ready')
    } catch (error) {
      toast.error('Failed to load fraud alerts')
      setReadState('failed')
      setReadRefused(isReadRefusal(error))
    } finally {
      setLoading(false)
    }
  }

  const handleResolve = async (id: string) => {
    try {
      await resolveFraudAlert(id)
      toast.success('Fraud alert resolved')
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'resolved' } : a))
    } catch (error) {
      toast.error('Failed to resolve fraud alert')
    }
  }

  const openAlerts = alerts.filter(a => a.status === 'open').length
  const underInvestigation = alerts.filter(a => a.status === 'under-investigation').length
  const resolved = alerts.filter(a => a.status === 'resolved').length
  // RX06-LR06 U10-S1 (unified only): counts compare the recorded status without case, and are shown only after a read.
  const readFailed = unified && readState === 'failed'
  const unifiedCount = (status: string) => readState === 'ready' ? String(alerts.filter(a => normalizedStatus(a.status) === status).length) : readState === 'loading' ? 'Loading…' : 'Not available'

  if (unified) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold">Fraud Alerts</h1>
          <p className="text-gray-500">Recorded fraud alerts that may need investigation</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4" data-testid="fraud-alert-counts">
          <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Open alerts</p><p className="text-2xl font-bold text-red-600" data-testid="fraud-alert-count-open">{unifiedCount('open')}</p></CardContent></Card>
          <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Resolved alerts</p><p className="text-2xl font-bold text-green-600" data-testid="fraud-alert-count-resolved">{unifiedCount('resolved')}</p></CardContent></Card>
        </div>

        <div className="space-y-4">
          {readFailed ? (
            <ReadFailedNotice subject="fraud alerts" refused={readRefused} onRetry={() => void loadAlerts()} testId="fraud-alerts-read-failed" />
          ) : loading ? (
            <Card className="border-0 card-shadow"><CardContent className="p-5 flex gap-4"><Skeleton className="w-10 h-10 rounded-lg" /><div className="flex-1 space-y-2"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-4 w-1/2" /></div></CardContent></Card>
          ) : alerts.length === 0 ? (
            <div className="text-center py-10 text-gray-500" data-testid="fraud-alerts-empty">No fraud alerts are recorded.</div>
          ) : (
            (alerts as RecordedFraudAlert[]).map((alert) => {
              const severity = normalizedStatus(alert.severity)
              const isResolved = normalizedStatus(alert.status) === 'resolved'
              return (
                <Card key={alert.id} className={`border-0 card-shadow ${severity === 'high' ? 'ring-1 ring-red-200' : severity === 'medium' ? 'ring-1 ring-amber-200' : ''}`} data-testid={`fraud-alert-${alert.id}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${severity === 'high' ? 'bg-red-100' : severity === 'medium' ? 'bg-amber-100' : 'bg-gray-100'}`}>
                        <AlertTriangle className={`w-5 h-5 ${severity === 'high' ? 'text-red-600' : severity === 'medium' ? 'text-amber-600' : 'text-gray-600'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h3 className="font-semibold">{alert.alert_type || alert.type || 'Alert type not recorded'}</h3>
                          <Badge className={CHIP[severity === 'high' ? 'negative' : severity === 'medium' ? 'pending' : 'neutral']}>{alert.severity || 'Severity not recorded'}</Badge>
                          <Badge className={CHIP[isResolved ? 'positive' : 'neutral']} data-testid="fraud-alert-status">{alert.status || 'Status not recorded'}</Badge>
                        </div>
                        <p className="text-sm text-gray-700 mb-2">{alert.description || 'No description recorded'}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-gray-500" data-testid="fraud-alert-recorded-fields">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Raised: {recordedDate(alert.created_at) ?? 'Date not recorded'}</span>
                          {isResolved && <span>Resolved: {recordedDate(alert.resolved_at) ?? 'Date not recorded'}</span>}
                          <span className="break-all">Reference: {alert.id}</span>
                        </div>
                      </div>
                      {!isResolved && (
                        <Button size="sm" variant="outline" className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-0 text-green-700 hover:text-green-800 hover:bg-green-50" title="Resolve Alert" aria-label="Resolve Alert" onClick={() => handleResolve(alert.id)} data-testid="fraud-alert-resolve">
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Fraud Alerts</h1>
        <p className="text-gray-500">AI-detected potential fraud cases requiring investigation</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Open Alerts</p><p className="text-2xl font-bold text-red-600">{openAlerts}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Under Investigation</p><p className="text-2xl font-bold text-amber-600">{underInvestigation}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Resolved</p><p className="text-2xl font-bold text-green-600">{resolved}</p></CardContent></Card>
      </div>

      <div className="space-y-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border-0 card-shadow">
              <CardContent className="p-5 flex gap-4">
                <Skeleton className="w-10 h-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-1/4" />
                </div>
                <Skeleton className="w-16 h-8" />
              </CardContent>
            </Card>
          ))
        ) : (
          alerts.map((alert) => (
            <Card key={alert.id} className={`border-0 card-shadow ${alert.severity === 'high' ? 'ring-1 ring-red-200' : alert.severity === 'medium' ? 'ring-1 ring-amber-200' : ''}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${alert.severity === 'high' ? 'bg-red-100' : alert.severity === 'medium' ? 'bg-amber-100' : 'bg-gray-100'}`}>
                    <AlertTriangle className={`w-5 h-5 ${alert.severity === 'high' ? 'text-red-600' : alert.severity === 'medium' ? 'text-amber-600' : 'text-gray-600'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{alert.type}</h3>
                        <Badge className={alert.severity === 'high' ? 'bg-red-500' : alert.severity === 'medium' ? 'bg-amber-500' : 'bg-gray-500'}>{alert.severity}</Badge>
                        {alert.status === 'resolved' && (
                          <Badge className="bg-green-500">Resolved</Badge>
                        )}
                      </div>
                      <span className="text-sm text-gray-500">{alert.id}</span>
                    </div>
                    <p className="text-sm text-gray-700 mb-2">{alert.description}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><Car className="w-3 h-3" />{alert.vehicle}</span>
                      <span>{alert.policyholder}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{alert.date || new Date().toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" title="View Details"><Eye className="w-4 h-4" /></Button>
                    {alert.status !== 'resolved' && (
                      <Button size="sm" variant="outline" className="text-green-600 hover:text-green-700 hover:bg-green-50" title="Resolve Alert" onClick={() => handleResolve(alert.id)}>
                        <CheckCircle className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
        {!loading && alerts.length === 0 && (
          <div className="text-center py-10 text-gray-500">
            No fraud alerts found.
          </div>
        )}
      </div>
    </div>
  )
}