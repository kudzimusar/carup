import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, DollarSign, Car, Star, Loader2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

const mockMonthlySales = [
  { month: 'Jan', sales: 8, revenue: 320000 },
  { month: 'Feb', sales: 10, revenue: 410000 },
  { month: 'Mar', sales: 12, revenue: 486000 },
  { month: 'Apr', sales: 9, revenue: 350000 },
  { month: 'May', sales: 14, revenue: 520000 },
]

const categorySplit = [
  { name: 'SUVs', value: 45 },
  { name: 'Sedans', value: 25 },
  { name: 'Pickups', value: 20 },
  { name: 'Hatchbacks', value: 10 },
]

const COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6']

export default function SalesAnalytics() {
  const { fetchVehicles, loading } = useCarUpApi()
  const [liveStats, setLiveStats] = useState({
    totalRevenue: 2090000,
    unitsSold: 53,
    avgPrice: 39400,
  })

  useEffect(() => {
    fetchVehicles().then(data => {
      if (data && data.length > 0) {
        const soldVehicles = data.filter((v: any) => v.status === 'sold')
        const totalRev = soldVehicles.reduce((acc: number, v: any) => acc + (v.price || 0), 0)
        setLiveStats({
          totalRevenue: totalRev,
          unitsSold: soldVehicles.length,
          avgPrice: soldVehicles.length ? totalRev / soldVehicles.length : 0
        })
      }
    }).catch(console.error)
  }, [fetchVehicles])

  const formatCurrency = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`
    if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`
    return `$${val}`
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Sales Analytics
            {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </h1>
          <p className="text-gray-500">Performance metrics and insights</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Revenue', value: formatCurrency(liveStats.totalRevenue), change: '+12%', up: true, icon: DollarSign },
          { label: 'Units Sold', value: liveStats.unitsSold.toString(), change: '+8%', up: true, icon: Car },
          { label: 'Avg. Sale Price', value: formatCurrency(liveStats.avgPrice), change: '-2%', up: false, icon: TrendingUp },
          { label: 'Customer Rating', value: '4.8', change: '+0.2', up: true, icon: Star },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 card-shadow transition-all hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <stat.icon className="w-5 h-5 text-orange-500" />
                <Badge variant="outline" className={stat.up ? 'text-green-600 border-green-200 bg-green-50' : 'text-red-600 border-red-200 bg-red-50'}>
                  {stat.up ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                  {stat.change}
                </Badge>
              </div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-sm text-gray-500">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-0 card-shadow">
          <CardHeader className="pb-3"><CardTitle className="text-lg">Monthly Sales</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={mockMonthlySales}>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Bar dataKey="sales" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardHeader className="pb-3"><CardTitle className="text-lg">Sales by Category</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={categorySplit} cx="50%" cy="50%" outerRadius={100} dataKey="value" label>
                  {categorySplit.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-4 mt-2">
              {categorySplit.map((cat, i) => (
                <div key={cat.name} className="flex items-center gap-1.5 text-sm">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                  <span className="font-medium text-gray-700">{cat.name} ({cat.value}%)</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}