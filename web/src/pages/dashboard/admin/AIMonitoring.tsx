import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Brain, MessageSquare, Zap, Clock, CheckCircle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import type { ServerHealthModel } from '@/types'

const requestData = [
  { hour: '00', requests: 120 },
  { hour: '04', requests: 45 },
  { hour: '08', requests: 450 },
  { hour: '12', requests: 680 },
  { hour: '16', requests: 520 },
  { hour: '20', requests: 310 },
]

const accuracyData = [
  { day: 'Mon', accuracy: 96 },
  { day: 'Tue', accuracy: 97 },
  { day: 'Wed', accuracy: 95 },
  { day: 'Thu', accuracy: 98 },
  { day: 'Fri', accuracy: 97 },
  { day: 'Sat', accuracy: 96 },
  { day: 'Sun', accuracy: 97 },
]

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
        {[
          { label: 'Total Requests', value: '24.5K', icon: MessageSquare, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'Avg Response Time', value: '1.2s', icon: Clock, color: 'text-green-500', bg: 'bg-green-50' },
          { label: 'Accuracy', value: '97.2%', icon: CheckCircle, color: 'text-purple-500', bg: 'bg-purple-50' },
          { label: 'Active Sessions', value: '142', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-50' },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 card-shadow">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
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
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={requestData}>
                <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="requests" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardHeader className="pb-3"><CardTitle className="text-lg">Accuracy Trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={accuracyData}>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <YAxis domain={[90, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="accuracy" stroke="#f97316" strokeWidth={2} dot={{ fill: '#f97316' }} />
              </LineChart>
            </ResponsiveContainer>
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
            healthData.map((model: ServerHealthModel, index: number) => (
              <div key={model.name || index}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-purple-500" />
                    <span className="text-sm font-medium">{model.name || 'Unknown Model'}</span>
                    <Badge className={`${model.status === 'Operational' ? 'bg-green-500' : 'bg-amber-500'} text-white text-[10px]`}>
                      {model.status || 'Unknown'}
                    </Badge>
                  </div>
                  <span className="text-sm">{model.accuracy || 0}%</span>
                </div>
                <Progress value={model.accuracy || 0} className="h-2" />
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-500 py-4 text-center">No health data available</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}