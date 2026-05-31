// @ts-nocheck
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { TrendingUp, TrendingDown, Shield, Car, AlertTriangle, Sparkles, DollarSign, Calculator } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useCarUpApi } from '@/hooks/useCarUpApi'

const riskByCategory = [
  { category: 'SUVs', risk: 3.2, claims: 45 },
  { category: 'Sedans', risk: 2.8, claims: 38 },
  { category: 'Pickups', risk: 4.1, claims: 52 },
  { category: 'Hatchbacks', risk: 2.1, claims: 22 },
  { category: 'Luxury', risk: 5.8, claims: 18 },
]

export default function RiskAnalysis() {
  const { runRiskAssessment } = useCarUpApi()
  const [vin, setVin] = useState('VIN74329849204928')
  const [mileage, setMileage] = useState(48500)
  const [basePrice, setBasePrice] = useState(42000)
  
  const [loading, setLoading] = useState(false)
  const [riskData, setRiskData] = useState({
    riskScore: 24.5,
    recommendedPremium: 145.00,
    currency: 'USD',
    factors: [
      { name: 'Odometer progressive validation passed', impact: 'Positive' },
      { name: 'Service consistency maintained on ledger', impact: 'Positive' },
      { name: 'Import ZIMRA duty cleared in Harare', impact: 'Positive' }
    ]
  })

  const handleCalculate = async () => {
    setLoading(true)
    try {
      const data = await runRiskAssessment(vin, Number(mileage), Number(basePrice))
      setRiskData(data)
      toast.success('Dynamic Premium Calculated successfully.')
    } catch (err) {
      toast.error('Failed to run dynamic risk assessment.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-orange-500 animate-pulse" />
          Risk Analysis & Dynamic Premium Modulator
        </h1>
        <p className="text-gray-500">Calculate dynamic monthly insurance premiums based on live ledger Trust Scores and mileage histories.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Dynamic Modulator Form */}
        <Card className="border-0 card-shadow bg-white col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-1.5 text-gray-800">
              <Calculator className="w-5 h-5 text-orange-500" />
              Dynamic Premium Modulator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500">Vehicle VIN</label>
              <Input value={vin} onChange={e => setVin(e.target.value)} placeholder="Enter vehicle VIN..." />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500">Current Mileage (km)</label>
              <Input type="number" value={mileage} onChange={e => setMileage(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500">Declared Value (USD)</label>
              <Input type="number" value={basePrice} onChange={e => setBasePrice(e.target.value)} />
            </div>
            <Button onClick={handleCalculate} disabled={loading} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium">
              {loading ? 'Analyzing...' : 'Recalculate Premium'}
            </Button>
          </CardContent>
        </Card>

        {/* Dynamic Modulator Results */}
        <Card className="border-0 card-shadow bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white col-span-2 relative overflow-hidden flex flex-col justify-between p-6">
          <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-2xl -mr-8 -mt-8" />
          <div className="z-10 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs text-orange-400 font-semibold tracking-wider uppercase">Live Risk Assessment</span>
                <h3 className="text-2xl font-bold mt-1">CarUp Trust Risk Score</h3>
              </div>
              <Badge className="bg-orange-500 text-white font-semibold shadow-none border-none">
                Risk Tier: {riskData.riskScore < 30 ? 'Low' : riskData.riskScore < 60 ? 'Medium' : 'High'}
              </Badge>
            </div>

            <div className="grid sm:grid-cols-2 gap-6 py-2">
              <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                <p className="text-xs text-gray-400">Monthly Underwritten Premium</p>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-3xl font-extrabold text-orange-400">${riskData.recommendedPremium.toFixed(2)}</span>
                  <span className="text-xs text-gray-400">{riskData.currency}</span>
                </div>
                <p className="text-[10px] text-green-400 font-medium mt-2 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" /> Includes 25% Trust Score discount
                </p>
              </div>

              <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                <p className="text-xs text-gray-400">Calculated Risk Index</p>
                <p className="text-3xl font-extrabold text-white mt-1">{riskData.riskScore}%</p>
                <Progress value={riskData.riskScore} className="h-1.5 bg-white/10 mt-3" indicatorClassName="bg-orange-500" />
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <p className="text-xs font-semibold text-gray-400">AI Risk Assessment Mitigators</p>
              {riskData.factors.map((f, i) => (
                <div key={i} className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg text-xs border border-white/5">
                  <span className="text-gray-300">{f.name}</span>
                  <span className="text-green-400 font-medium">{f.impact}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-0 card-shadow">
          <CardHeader className="pb-3"><CardTitle className="text-lg">Risk by Vehicle Category</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={riskByCategory}>
                <XAxis dataKey="category" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="risk" fill="#f97316" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardHeader className="pb-3"><CardTitle className="text-lg">Insurance Trust Engine Parameters</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {[
              { rule: 'Trust Score above 90%', discount: '25% premium reduction' },
              { rule: 'Tamper-free OdoAudit ledger history', discount: '10% premium reduction' },
              { rule: 'ZIMRA duty cleared documentation', discount: 'Waived import risk loading' },
              { rule: 'Registered with digital police network', discount: '5% security discount' }
            ].map((r, idx) => (
              <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
                <div>
                  <p className="font-semibold text-sm text-gray-800">{r.rule}</p>
                </div>
                <Badge className="text-green-600 bg-white border border-gray-200 shadow-none text-xs">
                  {r.discount}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}