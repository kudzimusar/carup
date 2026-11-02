import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Brain, Activity } from 'lucide-react'
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">AI Monitoring</h1>
        <p className="text-gray-500">CarUp AI provider and model health</p>
      </div>

      <Card className="border-0 card-shadow">
        <CardContent className="p-5 flex gap-3 items-start">
          <Activity className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Measured telemetry only</p>
            <p className="text-sm text-gray-500 mt-1">
              Request volume, response-time, accuracy, and active-session KPIs are not displayed until
              a canonical telemetry source supplies them. CarUp does not substitute demonstration metrics.
            </p>
          </div>
        </CardContent>
      </Card>

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
              const accuracy = typeof model.accuracy === 'number' ? model.accuracy : null
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
                    <span className="text-sm">{accuracy == null ? 'Not measured' : `${accuracy}%`}</span>
                  </div>
                  {accuracy != null && <Progress value={accuracy} className="h-2" />}
                </div>
              )
            })
          ) : (
            <div className="text-sm text-gray-500 py-4 text-center">
              No canonical AI health data is available.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
