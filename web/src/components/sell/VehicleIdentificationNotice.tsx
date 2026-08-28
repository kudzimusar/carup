/**
 * Seller Journey 1.0 / S1 — one shared existing-Passport notice for both Sell surfaces.
 *
 * Both Guest Sell and authenticated Sell render this. Neither surface owns its own copy of the
 * detection rules, the wording, or the truth boundaries — see `@/lib/sellerVehicleIdentification`
 * and `@/hooks/useSellerVehicleIdentification`.
 */
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import { sellerIdentificationMessage, type SellerVehicleIdentification } from '@/lib/sellerVehicleIdentification'

export function VehicleIdentificationNotice({
  result,
  checking,
}: {
  result: SellerVehicleIdentification
  checking: boolean
}) {
  if (checking) {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-500" data-testid="sell-vin-identification-checking">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Checking CarUp Passport records…
      </p>
    )
  }

  const message = sellerIdentificationMessage(result)
  if (!message) return null

  if (result.state === 'passport_exists') {
    const found = result.passportVehicle
    // Identity only. Colour, mileage, price and condition stay this seller's to state.
    const described = [found?.year, found?.make, found?.model].filter(Boolean).join(' ')
    return (
      <div
        className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
        data-testid="sell-vin-passport-exists"
        role="status"
      >
        <p className="flex items-start gap-2 font-bold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{message}</span>
        </p>
        {described && (
          <p className="mt-1 pl-6 font-semibold" data-testid="sell-vin-passport-described">
            CarUp's record describes: {described}.
          </p>
        )}
        <p className="mt-1 pl-6">
          CarUp will not copy that record's details into this form. Every fact below stays yours to state.
        </p>
      </div>
    )
  }

  const tone =
    result.state === 'no_carup_record'
      ? { className: 'text-emerald-700', Icon: CheckCircle2, testId: 'sell-vin-no-carup-record' }
      : { className: 'text-slate-500', Icon: Info, testId: 'sell-vin-check-unavailable' }

  return (
    <p className={`mt-2 flex items-start gap-2 text-xs font-semibold ${tone.className}`} data-testid={tone.testId} role="status">
      <tone.Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  )
}
