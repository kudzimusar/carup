import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Activity, Brain, CheckCircle, CircleOff } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import type { ServerHealthModel } from '@/types'

export default function AIMonitoring() {
  const { fetchServerHealth } = useCarUpApi()
  const [healthData, setHealthData] = useState<ServerHealthModel[]>([])
  const [initialLoading, setInitialLoading] = useState(true)

  useEffect(() => {
    const loadHealth = async () => {
      try {
        const data = await fetchServerHealth()
        setHealthData(Array.isArray(data) ? data : (data?.models || []))
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to fetch server health')
      } finally {
        setInitialLoading(false)
      }
    }
    loadHealth()
  }, [fetchServerHealth])

  const operational = healthData.filter((model) => model.status === 'Operational').length

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">AI Monitoring</h1>
        <p className="text-gray-500">Live CarUp AI provider health. Unconnected telemetry is shown as unavailable, never estimated.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Models Reporting', value: initialLoading ? '…' : String(healthData.length), icon: Brain },
          { label: 'Operational', value: initialLoading ? '…' : String(operational), icon: CheckCircle },
          { label: 'Request Volume', value: 'Not connected', icon: Activity },
          { label: 'Aggregate Accuracy', value: 'Not connected', icon: CircleOff },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 card-shadow">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <p className="text-xl font-bold mt-1">{stat.value}</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 card-shadow">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">AI Model Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {initialLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
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
              const accuracy = Number(model.accuracy)
              const hasAccuracy = Number.isFinite(accuracy)
              return (
                <div key={model.name || index}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Brain className="w-4 h-4 text-purple-500" />
                      <span className="text-sm font-medium">{model.name || 'Unknown Model'}</span>
                      <Badge className={`${model.status === 'Operational' ? 'bg-green-500' : 'bg-amber-500'} text-white text-[10px]`}>
                        {model.status || 'Unknown'}
                      </Badge>
                    </div>
                    <span className="text-sm">{hasAccuracy ? `${accuracy}%` : 'Accuracy unavailable'}</span>
                  </div>
                  {hasAccuracy ? <Progress value={accuracy} className="h-2" /> : null}
                </div>
              )
            })
          ) : (
            <div className="text-sm text-gray-500 py-4 text-center">No live model-health data available</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
