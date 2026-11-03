import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { MONEY_ACTION_BUTTON_CLASS } from '@/lib/pay04GaragePayments'
import { paynowContinuable, paynowOtpFailure, type PaynowOutcome, type PaynowView } from '@/lib/pay05Paynow'

/** Only Paynow's own http(s) page is ever a link: anything else in checkout_url is treated as no link at all. */
const pageLink = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null)

/**
 * CARUP-PAY-05 — what the customer can do to continue a Paynow request that already exists: open Paynow's page again,
 * read the InnBucks code, or give O'mari's SMS code. Shared by the checkout that just started the request, the invoice's
 * list of payments and the notice shown on coming back from Paynow.
 *
 * It offers exactly what Paynow gave CarUp, and nothing once CarUp has stopped waiting on the request. A request recovered
 * by trace has no page link; the panel says so rather than inventing one. Paynow's answer to an O'mari code is handed to
 * the parent (`onOtpOutcome`), which shows it and refreshes.
 */
export default function PaynowPendingPanel({ collectionId, paynow, state = null, busy = false, onOtpOutcome, className = '' }: {
  collectionId: string
  paynow: PaynowView
  /** the collection's state when known */
  state?: string | null
  busy?: boolean
  onOtpOutcome?: (outcome: PaynowOutcome) => void
  className?: string
}) {
  const { submitPaynowOtp } = useCarUpApi()
  const uid = useId()
  const [otp, setOtp] = useState('')
  const [otpProblem, setOtpProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  if (!paynowContinuable(state, paynow)) return null
  const link = pageLink(paynow.checkout_url)
  const noLink = paynow.method === 'web' && !link && (paynow.provider_status === null || paynow.provider_status === 'created')
  if (!link && !noLink && !paynow.instructions && !paynow.authorization_code && !paynow.needs_otp && !paynow.otp_unavailable) return null

  const sendOtp = async () => {
    if (!/^\d{4,8}$/.test(otp.trim())) { setOtpProblem('Enter the code from the SMS (numbers only).'); return }
    setSending(true)
    setOtpProblem(null)
    try {
      const outcome = await submitPaynowOtp(collectionId, otp.trim())
      setOtp('')
      onOtpOutcome?.(outcome)
    } catch (err) {
      // only Paynow's own refusal is definite: a lost answer means Paynow may have taken the payment (ICR-W4)
      setOtpProblem(paynowOtpFailure(err).text)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={`space-y-2 ${className}`} data-testid="paynow-continue">
      {link && (
        <a href={link} className={`inline-flex min-h-11 items-center rounded-md px-4 py-2 text-sm font-medium ${MONEY_ACTION_BUTTON_CLASS}`}
          data-testid="paynow-continue-link">
          Continue on Paynow
        </a>
      )}
      {noLink && (
        <p className="text-sm" data-testid="paynow-no-link">Paynow did not give CarUp a page link for this request; check its status or stop waiting.</p>
      )}
      {paynow.instructions && <p className="text-sm" data-testid="paynow-instructions">{paynow.instructions}</p>}
      {paynow.authorization_code && (
        <div className="rounded-md border border-amber-400 bg-white p-2" data-testid="paynow-innbucks">
          <p className="text-sm">Your InnBucks code</p>
          <p className="font-mono text-2xl tracking-widest" data-testid="paynow-innbucks-code">{paynow.authorization_code}</p>
          {paynow.authorization_expires && <p className="text-xs text-gray-700">Valid until {paynow.authorization_expires} (Paynow’s time)</p>}
        </div>
      )}
      {paynow.otp_unavailable && (
        <p className="text-sm" data-testid="paynow-otp-unavailable">
          Paynow did not give CarUp a way to send your O’mari code for this request. Check its status; if it stays waiting, the garage or CarUp can release it.
        </p>
      )}
      {paynow.needs_otp && (
        <div className="space-y-1" data-testid="paynow-otp">
          <label htmlFor={`${uid}-otp`} className="block text-sm font-medium">
            Code from the O’mari SMS{paynow.otp_reference ? ` (reference ${paynow.otp_reference})` : ''}
          </label>
          <div className="flex flex-wrap gap-2">
            <input id={`${uid}-otp`} inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(e) => { setOtp(e.target.value); setOtpProblem(null) }}
              aria-invalid={Boolean(otpProblem)} aria-describedby={otpProblem ? `${uid}-otp-problem` : !otp.trim() ? `${uid}-otp-hint` : undefined}
              className="min-h-11 w-40 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid="paynow-otp-input" />
            <Button className={`min-h-11 ${MONEY_ACTION_BUTTON_CLASS}`} disabled={busy || sending || !otp.trim()}
              aria-describedby={!otp.trim() ? `${uid}-otp-hint` : undefined} onClick={() => void sendOtp()} data-testid="paynow-otp-submit">
              Send code to Paynow
            </Button>
          </div>
          {!otp.trim() && <p id={`${uid}-otp-hint`} className="text-xs text-gray-700" data-testid="paynow-otp-hint">Enter the code from the SMS first.</p>}
          {otpProblem && <p id={`${uid}-otp-problem`} role="alert" className="text-sm text-red-800" data-testid="paynow-otp-problem">{otpProblem}</p>}
        </div>
      )}
    </div>
  )
}
