import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Wrench, Search, Calendar, Gauge, Building2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { Vehicle } from '@/types'

/**
 * Owner Service History (Service Network S6).
 *
 * This surface previously carried four truth debts recorded in the canonical plan:
 * a hard-coded "Next Service — 500 km" that no authority supported, an unrecorded cost
 * rendered as "$0", the generic literal "Garage" standing in for provider identity, and
 * a "$" prefix that assumed USD.
 *
 * All four are removed rather than restyled. Every value now comes from the governed
 * owner projection, and anything the platform does not actually know is shown as not
 * recorded — unknown is never displayed as zero, and never as a guess.
 */

type Provider = { known: boolean; display_name: string | null; slug: string | null }
type Cost = { recorded: boolean; amount: number | null; currency: string | null }
type MileageObservation = { observed_mileage: number; observed_at: string; source: string } | null

type ServiceHistoryEntry = {
  id: string
  vin: string
  status: string
  description: string | null
  issue_description: string | null
  service_category: string | null
  work_performed: string | null
  provenance: string
  provider: Provider
  cost: Cost
  completed_at: string | null
  performed_at: string | null
  created_at: string
  mileage_observation: MileageObservation
}

const PROVENANCE_LABELS: Record<string, string> = {
  owner_declared: 'Owner declared',
  garage_stated: 'Garage stated',
  mechanic_attributed: 'Mechanic attributed',
  professional_governed: 'Professionally governed',
  evidence_backed: 'Evidence backed',
  partner_record: 'Partner record',
  unknown: 'Source not recorded',
}

function formatCost(cost: Cost): string {
  // Money is shown only when both the amount and its currency are known. An
  // unrecorded cost is stated as unrecorded — it is never rendered as zero, and
  // no currency is assumed.
  if (!cost.recorded || cost.amount === null || !cost.currency) return 'Cost not recorded'
  return `${cost.currency} ${cost.amount.toLocaleString()}`
}

export default function ServiceHistory() {
  const { fetchOwnedVehicles, fetchServiceHistory } = useCarUpApi()
  const [search, setSearch] = useState('')
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [allServices, setAllServices] = useState<ServiceHistoryEntry[]>([])
  const [selectedVehicle, setSelectedVehicle] = useState<string>('')
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    Promise.all([fetchOwnedVehicles(), fetchServiceHistory()])
      .then(([vData, sData]) => {
        setVehicles(vData)
        setAllServices((sData || []) as ServiceHistoryEntry[])
        setLoadFailed(false)
        if (vData.length > 0) setSelectedVehicle(vData[0].vin)
      })
      .catch(() => setLoadFailed(true))
  }, [fetchOwnedVehicles, fetchServiceHistory])

  const describe = (s: ServiceHistoryEntry) =>
    s.work_performed || s.description || s.issue_description || ''

  const services = allServices.filter(s =>
    s.vin === selectedVehicle &&
    (!search || describe(s).toLowerCase().includes(search.toLowerCase())),
  )

  // Only services whose cost is actually recorded can contribute to a total, and a
  // total is only meaningful within one currency. Mixed or partial data is reported
  // honestly rather than summed into a single misleading figure.
  const recorded = services.filter(s => s.cost.recorded && s.cost.currency)
  const currencies = [...new Set(recorded.map(s => s.cost.currency as string))]
  const singleCurrency = currencies.length === 1 ? currencies[0] : null
  const recordedTotal = singleCurrency
    ? recorded.reduce((a, s) => a + (s.cost.amount || 0), 0)
    : null
  const unrecordedCount = services.length - recorded.length

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Service History</h1>
          <p className="text-gray-500">Recorded maintenance for your vehicles</p>
        </div>
      </div>

      {loadFailed && (
        <Card className="border-0 card-shadow" data-testid="service-history-error">
          <CardContent className="p-6 text-center">
            <p className="font-semibold text-gray-800">Service history could not be loaded</p>
            <p className="text-sm text-gray-500 mt-1">
              This is a loading problem, not a statement that you have no service history.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {vehicles.map(v => (
          <button
            key={v.vin}
            onClick={() => setSelectedVehicle(v.vin)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedVehicle === v.vin ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {v.make} {v.model}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="border-0 card-shadow">
          <CardContent className="p-5">
            <p className="text-sm text-gray-500">Recorded Services</p>
            <p className="text-2xl font-bold" data-testid="service-count">{services.length}</p>
          </CardContent>
        </Card>
        <Card className="border-0 card-shadow">
          <CardContent className="p-5">
            <p className="text-sm text-gray-500">Recorded Spend</p>
            <p className="text-2xl font-bold text-orange-600" data-testid="recorded-spend">
              {recordedTotal !== null
                ? `${singleCurrency} ${recordedTotal.toLocaleString()}`
                : currencies.length > 1
                  ? 'Multiple currencies'
                  : 'Not recorded'}
            </p>
            {unrecordedCount > 0 && (
              <p className="text-xs text-gray-500 mt-1" data-testid="unrecorded-note">
                {unrecordedCount} service{unrecordedCount === 1 ? '' : 's'} with no cost recorded
                {recordedTotal !== null ? ' are not included' : ''}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search services..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
          aria-label="Search services"
        />
      </div>

      {!loadFailed && services.length === 0 && (
        <Card className="border-0 card-shadow" data-testid="service-history-empty">
          <CardContent className="p-8 text-center">
            <Wrench className="w-7 h-7 text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-800">No service recorded for this vehicle yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Services appear here once a garage records them on CarUp.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {services.map(service => (
          <Card key={service.id} className="border-0 card-shadow">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
                  <Wrench className="w-5 h-5 text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <h3 className="font-semibold truncate">{describe(service) || 'Service'}</h3>
                    <Badge className={String(service.status).toLowerCase() === 'completed' ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'}>
                      {service.status}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" aria-hidden="true" />
                      {new Date(service.performed_at || service.completed_at || service.created_at).toLocaleDateString()}
                    </span>

                    <span className="flex items-center gap-1" data-testid="entry-provider">
                      <Building2 className="w-3 h-3" aria-hidden="true" />
                      {service.provider.known
                        ? (service.provider.slug
                            ? <Link to={`/garages/${service.provider.slug}`} className="hover:underline">{service.provider.display_name}</Link>
                            : service.provider.display_name)
                        : 'Provider not recorded'}
                    </span>

                    <span data-testid="entry-cost">{formatCost(service.cost)}</span>

                    {service.mileage_observation && (
                      <span className="flex items-center gap-1" data-testid="entry-mileage">
                        <Gauge className="w-3 h-3" aria-hidden="true" />
                        {service.mileage_observation.observed_mileage.toLocaleString()} km observed
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-gray-400 mt-2" data-testid="entry-provenance">
                    {PROVENANCE_LABELS[service.provenance] || PROVENANCE_LABELS.unknown}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
