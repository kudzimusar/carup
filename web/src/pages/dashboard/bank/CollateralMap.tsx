/**
 * Collateral tracking — CarUp Intelligence I11.
 *
 * This page presented invented vehicles as a lender's financed assets, and did so
 * in the two situations where a reader is least able to tell:
 *
 *   - when the telemetry table came back EMPTY, it injected three fabricated
 *     vehicles with VINs, models and live-looking positions;
 *   - when the read FAILED, it injected two more, under a comment describing them
 *     as a demo fallback.
 *
 * So a lender with no financed assets, and a lender whose data could not be read,
 * both saw a populated fleet — and the "N Financed Assets Connected" counter
 * counted the fabrications. "GPS Telemetry Core Active", "Ledger Sync: OK" and
 * "No active geofence breaches detected" were asserted unconditionally, for
 * systems that do not exist.
 *
 * The deeper problem is that the binding itself does not exist. `vehicle_telemetry`
 * carries only `vin, lat, lng, speed, status, timestamp` — no finance, loan or
 * collateral reference of any kind. Nothing in CarUp can say that a telemetry row
 * belongs to a financed vehicle, so generic vehicle telemetry can never honestly
 * be labelled "bank-financed assets". (On staging the telemetry rows are in fact
 * the placeholder demo VINs from an old seed migration, and none of them has a
 * finance application at all.)
 *
 * The page therefore reports the capability as not configured, and names what
 * would have to exist for it to work.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MapPin, Info } from 'lucide-react'

const MISSING_PREREQUISITES = [
  {
    key: 'collateral_binding',
    label: 'A finance ↔ collateral binding',
    detail:
      'Vehicle telemetry records a VIN, a position and a speed. It carries no loan, application or collateral reference, so no telemetry record can be attributed to a financed asset.',
  },
  {
    key: 'disbursed_book',
    label: 'A disbursed loan book',
    detail:
      'CarUp records no disbursement, so there is no financed vehicle to track. An application is a request, not an asset.',
  },
  {
    key: 'live_telemetry',
    label: 'A live telemetry feed',
    detail:
      'No live telemetry integration is connected. The rows CarUp holds are placeholder records from an old seed migration.',
  },
  {
    key: 'geofence',
    label: 'Geofencing',
    detail:
      'No geofence is defined anywhere in CarUp, so no breach can be detected and none can be reported as absent.',
  },
]

export default function CollateralMap() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MapPin className="w-6 h-6 text-gray-400" />
          Collateral tracking
        </h1>
        <p className="text-gray-500">Part of the governed credit domain, separate from commercial demand.</p>
      </div>

      <Card className="border-0 card-shadow" data-testid="collateral-not-configured">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Not configured</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            CarUp cannot currently identify a financed vehicle, so no collateral can be tracked.
            This is not an empty fleet — it is a capability that is not connected.
          </p>
          <ul className="space-y-3">
            {MISSING_PREREQUISITES.map((item) => (
              <li key={item.key} className="flex items-start gap-2" data-testid={`collateral-missing-${item.key}`}>
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-medium text-gray-800">{item.label}</span>
                  <span className="block text-xs text-gray-600">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
