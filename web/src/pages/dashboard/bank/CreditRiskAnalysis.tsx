import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { BarChart3, ArrowUpRight } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { FinanceApplication } from '@/types'

export default function CreditRiskAnalysis() {
  const { fetchFinanceApplications } = useCarUpApi()
  const [riskDistribution, setRiskDistribution] = useState([
    { grade: 'A (Super Trust)', count: 8 },
    { grade: 'B (High Trust)', count: 4 },
    { grade: 'C (Medium Trust)', count: 2 },
    { grade: 'D (Low Trust)', count: 1 },
  ])
  const [totalValue, setTotalValue] = useState(1245000)

  useEffect(() => {
    const loadApps = async () => {
      try {
        const apps = await fetchFinanceApplications()
        if (Array.isArray(apps) && apps.length > 0) {
          let a = 0, b = 0, c = 0, d = 0
          let value = 0
          apps.forEach((app: FinanceApplication) => {
            const score = app.trust_score || 0
            if (score >= 90) a++
            else if (score >= 80) b++
            else if (score >= 70) c++
            else d++

            if (app.requested_amount) {
              value += Number(app.requested_amount)
            }
          })
          setRiskDistribution([
            { grade: 'A (Super Trust)', count: a },
            { grade: 'B (High Trust)', count: b },
            { grade: 'C (Medium Trust)', count: c },
            { grade: 'D (Low Trust)', count: d },
          ])
          setTotalValue(value)
        }
      } catch (err) {
        console.error(err)
      }
    }
    loadApps()
  }, [fetchFinanceApplications])
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-600" />
            Credit Risk Analysis
          </h1>
          <p className="text-gray-500">System-wide credit analytics, portfolio distribution, and risk modeling.</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Portfolio Risk Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={riskDistribution}>
                  <XAxis dataKey="grade" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">AI Credit Model Factors</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {[
                { factor: 'Odometer progressive validation (OdoAudit)', weight: '35% weight', impact: 'Very High', color: 'text-green-600' },
                { factor: 'PartSentry replacement consistency logs', weight: '25% weight', impact: 'High', color: 'text-green-600' },
                { factor: 'Owner vehicle transaction history (SafePay)', weight: '20% weight', impact: 'Medium', color: 'text-blue-600' },
                { factor: 'ZIMRA custom import compliance record', weight: '20% weight', impact: 'Medium', color: 'text-blue-600' }
              ].map((item, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
                  <div>
                    <p className="font-semibold text-sm text-gray-800">{item.factor}</p>
                    <p className="text-xs text-gray-400">{item.weight}</p>
                  </div>
                  <Badge className={`${item.color} bg-white border border-gray-200 shadow-none`}>
                    {item.impact}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Portfolio Health Summary</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center border-b pb-3">
                <div>
                  <p className="text-xs text-gray-400">Total Portfolio Value</p>
                  <p className="text-xl font-bold">
                    ${totalValue >= 1000000 ? (totalValue / 1000000).toFixed(2) + 'M' : (totalValue / 1000).toFixed(2) + 'k'} USD
                  </p>
                </div>
                <ArrowUpRight className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex justify-between items-center border-b pb-3">
                <div>
                  <p className="text-xs text-gray-400">Non-Performing Loans</p>
                  <p className="text-xl font-bold">0.00%</p>
                </div>
                <Badge className="bg-green-100 text-green-700 font-semibold border-none">Healthy</Badge>
              </div>
              <div>
                <p className="text-xs text-gray-400">Escrow Split Security Coverage</p>
                <div className="flex items-center justify-between text-xs mt-1 mb-1">
                  <span>Funds Covered by Escrow</span>
                  <span className="font-bold">100%</span>
                </div>
                <Progress value={100} className="h-1.5 bg-gray-100" indicatorClassName="bg-indigo-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
