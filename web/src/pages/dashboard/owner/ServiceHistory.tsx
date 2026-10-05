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

import { type ServiceHistoryEntry, describeService, formatCost, provenanceLabel, serviceDate, providerLabel, mileageObservationLabel, summariseSpend } from '@/lib/ownerServiceHistory'

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

  const describe = describeService

  const services = allServices.filter(s =>
    s.vin === selectedVehicle &&
    (!search || describe(s).toLowerCase().includes(search.toLowerCase())),
  )

  // Only services whose cost is actually recorded can contribute to a total, and a
  // total is only meaningful within one currency. Mixed or partial data is reported
  // honestly rather than summed into a single misleading figure. ONE rule, shared with the
  // Passport (OC-5D): this page used to keep its own copy, which counted a "recorded" entry
  // with no amount as recorded and summed it as 0 — the fake zero the contract forbids.
  const spend = summariseSpend(services)

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
              {spend.label}
            </p>
            {spend.unrecordedCount > 0 && (
              <p className="text-xs text-gray-500 mt-1" data-testid="unrecorded-note">
                {spend.unrecordedCount} service{spend.unrecordedCount === 1 ? '' : 's'} with no cost recorded
                {spend.total !== null ? ' are not included' : ''}
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
                      {serviceDate(service)}
                    </span>

                    <span className="flex items-center gap-1" data-testid="entry-provider">
                      <Building2 className="w-3 h-3" aria-hidden="true" />
                      {service.provider?.known && service.provider.slug
                        ? <Link to={`/garages/${service.provider.slug}`} className="hover:underline">{service.provider.display_name}</Link>
                        : providerLabel(service.provider)}
                    </span>

                    <span data-testid="entry-cost">{formatCost(service.money)}</span>

                    {mileageObservationLabel(service.mileage_observation) && (
                      <span className="flex items-center gap-1" data-testid="entry-mileage">
                        <Gauge className="w-3 h-3" aria-hidden="true" />
                        {mileageObservationLabel(service.mileage_observation)}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-gray-400 mt-2" data-testid="entry-provenance">
                    {provenanceLabel(service.provenance)}
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
