/**
 * Institutional portal — CarUp Intelligence I15.
 *
 * Nothing on this page except the duty estimator talked to a server, and every
 * other element asserted something CarUp cannot know:
 *
 *   - four headline tiles — "Registered Vehicles 1.2M", "Pending Verifications
 *     234", "Verified Today 89", "Security Alerts Flagged 3 Active" — all string
 *     literals. CarUp is not a national registry and holds none of this;
 *   - a five-month national registration chart drawn from a fixed array;
 *   - a "Secure Hardware Session Audits (MFA)" panel listing invented officers by
 *     name, with invented IP addresses and timestamps, presented as a regulatory
 *     authentication log. CarUp holds no officer directory and issues no officer
 *     credentials;
 *   - a banner asserting that "Secure RBAC isolation is fully enforced" and naming
 *     a bank as a restricted party, with no check behind it;
 *   - and a duty result seeded into component state — $10,125 total, $1,500 VAT,
 *     101.3% of value — rendered on page load as though it were a ZIMRA
 *     assessment of the pre-filled inputs, before any calculation had run.
 *
 * That seed was also hiding a real defect: the API returns VAT under
 * `breakdown.vat`, not at the top level, so the first genuine calculation set
 * `dutyResult.vat` to undefined and `.toLocaleString()` on it would have thrown.
 * The page only appeared to work because the fabricated seed had the field.
 *
 * The estimator itself is real and is kept — but it is a CarUp calculation from
 * published rates, not a revenue-authority assessment, and it now says so. CarUp
 * has no ZIMRA integration: `provider_registry` is empty and every registry check
 * on record ran against a sandbox simulator.
 */
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Search, FileText, ArrowRight, Calculator, Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import GovernmentIntelligence from '@/components/intelligence/GovernmentIntelligence'

interface DutyEstimate {
  totalDuty: number
  percentageOfValue: number
  breakdown?: { customsDuty?: number; surtax?: number; vat?: number }
}

const money = (value?: number) => (
  typeof value === 'number' && Number.isFinite(value) ? `$${value.toLocaleString()}` : 'Not reported'
)

export default function GovernmentDashboard() {
  const { fetchZimraDuty } = useCarUpApi()

  const [vehicleValue, setVehicleValue] = useState(10000)
  const [vehicleYear, setVehicleYear] = useState(2017)
  const [engineSize, setEngineSize] = useState(1800)
  const [dutyLoading, setDutyLoading] = useState(false)
  // No seeded result: nothing is shown until a calculation actually runs.
  const [dutyResult, setDutyResult] = useState<DutyEstimate | null>(null)
  const [dutyError, setDutyError] = useState(false)

  const handleCalculateDuty = async () => {
    setDutyLoading(true)
    setDutyError(false)
    try {
      const data = await fetchZimraDuty(Number(vehicleValue), Number(vehicleYear), Number(engineSize))
      setDutyResult(data)
    } catch (err) {
      console.error(err)
      setDutyResult(null)
      setDutyError(true)
      toast.error('Failed to calculate the duty estimate.')
    } finally {
      setDutyLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Institutional portal</h1>
        <p className="text-gray-500">
          CarUp's own evidence review. Not a national registry and not a government record.
        </p>
      </div>

      {/* The governed institutional projection, which states plainly what CarUp
          has assessed itself and what no authoritative source has confirmed. */}
      <GovernmentIntelligence windowDays={30} />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-1.5">
                <Calculator className="w-5 h-5 text-indigo-600" />
                Import duty estimate
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Said before the inputs, not after the number. */}
              <p className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                <span data-testid="duty-estimate-basis">
                  CarUp calculates this from published rates. It is not connected to any revenue
                  authority, so this is an estimate — not an assessment, a ruling, or an amount
                  anybody owes.
                </span>
              </p>

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase" htmlFor="fob-value">FOB Value (USD)</label>
                  <Input id="fob-value" type="number" value={vehicleValue} onChange={e => setVehicleValue(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase" htmlFor="manufacture-year">Manufacture Year</label>
                  <Input id="manufacture-year" type="number" value={vehicleYear} onChange={e => setVehicleYear(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase" htmlFor="engine-size">Engine size (cc)</label>
                  <Input id="engine-size" type="number" value={engineSize} onChange={e => setEngineSize(Number(e.target.value))} />
                </div>
              </div>

              <Button onClick={handleCalculateDuty} disabled={dutyLoading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold" data-testid="calculate-duty">
                {dutyLoading ? 'Calculating…' : 'Calculate estimate'}
              </Button>

              {dutyError && (
                <p className="text-sm text-gray-600" data-testid="duty-estimate-failed">
                  The estimate could not be calculated. No figure is shown rather than a stale one.
                </p>
              )}

              {dutyResult ? (
                <div className="bg-gray-50 rounded-xl p-4 mt-2 border border-gray-100 grid sm:grid-cols-3 gap-4 text-center" data-testid="duty-estimate-result">
                  <div>
                    <p className="text-[10px] text-gray-400">Estimated total</p>
                    <p className="text-lg font-bold text-indigo-700" data-testid="duty-total">{money(dutyResult.totalDuty)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400">VAT</p>
                    {/* Read from the breakdown, which is where the API puts it. */}
                    <p className="text-lg font-bold text-gray-700" data-testid="duty-vat">{money(dutyResult.breakdown?.vat)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400">Share of value</p>
                    <p className="text-lg font-bold text-gray-700" data-testid="duty-percent">
                      {typeof dutyResult.percentageOfValue === 'number' && Number.isFinite(dutyResult.percentageOfValue)
                        ? `${dutyResult.percentageOfValue.toFixed(1)}%`
                        : 'Not reported'}
                    </p>
                  </div>
                </div>
              ) : !dutyError && (
                <p className="text-sm text-gray-500" data-testid="duty-estimate-idle">
                  Enter the vehicle details and calculate to see an estimate.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Registry Verification', href: '/government/registry', icon: Search },
                { label: 'Compliance Reports', href: '/government/compliance', icon: FileText },
              ].map((link) => (
                <Link key={link.label} to={link.href} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                  <link.icon className="w-4 h-4 text-indigo-600" />
                  <span className="flex-1 font-semibold">{link.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
