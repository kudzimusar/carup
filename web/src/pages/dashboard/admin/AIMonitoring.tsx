import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Brain, MessageSquare, Zap, Clock, CheckCircle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import type { ServerHealthModel } from '@/types'
import { DataState, DATA_STATE_HEADLINES } from '@/components/truth'

/**
 * RX-02 TI-06 — only the model-status list below is read from a source (/api/admin/health).
 * CarUp does not record AI request volume, latency, accuracy over time or active sessions, so those
 * tiles and charts say "Not measured" instead of showing fixed numbers as if they were live.
 */
const KPI_TILES = [
  { label: 'Total Requests', icon: MessageSquare, color: 'text-blue-500', bg: 'bg-blue-50' },
  { label: 'Avg Response Time', icon: Clock, color: 'text-green-500', bg: 'bg-green-50' },
  { label: 'Accuracy', icon: CheckCircle, color: 'text-purple-500', bg: 'bg-purple-50' },
  { label: 'Active Sessions', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-50' },
]

const recordedAccuracy = (model: ServerHealthModel) =>
  typeof model.accuracy === 'number' && Number.isFinite(model.accuracy) ? model.accuracy : null

export default function AIMonitoring() {
  const { fetchServerHealth } = useCarUpApi()
  const [healthData, setHealthData] = useState<ServerHealthModel[]>([])
  const [initialLoading, setInitialLoading] = useState(true)

  useEffect(() => {
    const loadHealth = async () => {
      try {
        const data = await fetchServerHealth()
        // Assuming data is an array or has a models property
        setHealthData(Array.isArray(data) ? data : (data?.models || []))
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to fetch server health')
      } finally {
        setInitialLoading(false)
      }
    }
    loadHealth()
  }, [fetchServerHealth])

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">AI Monitoring</h1>
        <p className="text-gray-500">Gutu AI performance and health metrics</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_TILES.map((stat) => (
          <Card key={stat.label} className="border-0 card-shadow" data-testid={`ai-kpi-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <p className="text-base font-semibold text-gray-500 mt-1">{DATA_STATE_HEADLINES['not-measured']}</p>
                </div>
                <div className={`w-10 h-10 rounded-lg ${stat.bg} ${stat.color} flex items-center justify-center`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-0 card-shadow">
          <CardHeader className="pb-3"><CardTitle className="text-lg">Request Volume (24h)</CardTitle></CardHeader>
          <CardContent>
            <DataState state="not-measured" subject="Request volume" description="CarUp does not record AI request volume yet, so no series is drawn." />
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardHeader className="pb-3"><CardTitle className="text-lg">Accuracy Trend</CardTitle></CardHeader>
          <CardContent>
            <DataState state="not-measured" subject="Accuracy trend" description="CarUp does not record AI accuracy over time yet, so no trend is drawn." />
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 card-shadow">
        <CardHeader className="pb-3"><CardTitle className="text-lg">AI Model Status</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {initialLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i}>
                  <div className="flex justify-between mb-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-2 w-full" />
                </div>
              ))}
            </div>
          ) : healthData.length > 0 ? (
            healthData.map((model: ServerHealthModel, index: number) => {
              // An absent accuracy is unknown, not 0%.
              const accuracy = recordedAccuracy(model)
              return (
                <div key={model.name || index} data-testid={`ai-model-${model.name || index}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Brain className="w-4 h-4 text-purple-500" />
                      <span className="text-sm font-medium">{model.name || 'Unknown Model'}</span>
                      <Badge className={`${model.status === 'Operational' ? 'bg-green-500' : 'bg-amber-500'} text-white text-[10px]`}>
                        {model.status || 'Unknown'}
                      </Badge>
                    </div>
                    {accuracy === null
                      ? <span className="text-sm text-gray-500">{DATA_STATE_HEADLINES['not-measured']}</span>
                      : <span className="text-sm">{accuracy}%</span>}
                  </div>
                  {accuracy !== null && <Progress value={accuracy} className="h-2" />}
                </div>
              )
            })
          ) : (
            <div className="text-sm text-gray-500 py-4 text-center">No health data available</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}