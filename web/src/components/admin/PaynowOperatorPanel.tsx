import { useCallback, useEffect, useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { formatMoney } from '@/lib/garageBusiness'
import { MONEY_ACTION_BUTTON_CLASS, pay04ErrorText } from '@/lib/pay04GaragePayments'
import {
  CURRENCY_NAME, MERCHANT_STATUS_LABEL, PAY05_NOT_OFFERED, PAYNOW_METHOD_LABEL, PROVIDER_ERROR_LABEL, isPay05Disabled, pay05ErrorText,
  type PaynowAvailability, type PaynowHeldCollection, type PaynowMerchant, type PaynowProviderError,
} from '@/lib/pay05Paynow'

/** Operators read the refusal in words and keep its code for support. */
function messageOf(e: unknown, fallback: string): string {
  if (!(e instanceof Error) || !e.message) return fallback
  const code = /\bPAY0[45]_[A-Z0-9_]+\b/.exec(e.message)?.[0]
  if (!code) return e.message
  return `${pay05ErrorText(code) ?? pay04ErrorText(code)} (${code})`
}

/**
 * CARUP-PAY-05 — the CarUp operator's Paynow work: verify each garage's OWN Paynow merchant (the server proves every
 * integration key with Paynow; you review the legal identity and the settlement account; you cannot review a garage you
 * belong to), switch Paynow on or off, release the hold of an unpaid Paynow request that Paynow cannot cancel (only after
 * a fresh check with Paynow), and see every provider error. Keys are never shown — only fingerprints.
 */
export default function PaynowOperatorPanel() {
  const { fetchPaynowMerchants, verifyPaynowMerchant, rejectPaynowMerchant, suspendPaynowMerchant, setPaynowAvailability,
    fetchPaynowProviderErrors, fetchPaynowHeldCollections, releasePaynowHold, reconcilePaynowCollection } = useCarUpApi()
  const uid = useId()
  const [merchants, setMerchants] = useState<PaynowMerchant[] | null>(null)
  const [availability, setAvailability] = useState<PaynowAvailability | null>(null)
  const [held, setHeld] = useState<PaynowHeldCollection[] | null>(null)
  const [errors, setErrors] = useState<PaynowProviderError[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [disabled, setDisabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [review, setReview] = useState<Record<string, { legal: boolean; settlement: boolean; currency: boolean; note: string }>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [availabilityNote, setAvailabilityNote] = useState('')

  const load = useCallback(async () => {
    try {
      const [m, h, e] = await Promise.all([fetchPaynowMerchants(), fetchPaynowHeldCollections(), fetchPaynowProviderErrors()])
      if (!Array.isArray(m?.merchants) || !Array.isArray(h?.held) || !Array.isArray(e?.errors)) throw new Error('Unexpected Paynow operator response')
      setMerchants(m.merchants); setAvailability(m.availability); setHeld(h.held); setErrors(e.errors); setLoadError(null); setDisabled(false)
    } catch (err) {
      // PAY-05 switched off on this server is a state, not a failure
      if (isPay05Disabled(err)) { setDisabled(true); setLoadError(null); return }
      setLoadError(messageOf(err, 'The Paynow operator view could not be loaded.'))
    }
  }, [fetchPaynowMerchants, fetchPaynowHeldCollections, fetchPaynowProviderErrors])
  useEffect(() => { void load() }, [load])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
      setMessage({ ok: true, text: ok })
      await load()
    } catch (e) {
      setMessage({ ok: false, text: messageOf(e, 'The action was refused.') })
    } finally {
      setBusy(false)
    }
  }
  const reasonOf = (id: string) => (reasons[id] ?? '').trim()
  const reasonInput = (id: string, label: string) => (
    <div>
      <label htmlFor={`${uid}-r-${id}`} className="block text-xs font-medium">{label} (at least 10 characters)</label>
      <input id={`${uid}-r-${id}`} value={reasons[id] ?? ''} onChange={(e) => setReasons({ ...reasons, [id]: e.target.value })}
        className="mt-1 w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid={`paynow-op-reason-${id}`} />
    </div>
  )

  const title = <h2 id={`${uid}-title`} className="text-lg font-semibold">Paynow (Zimbabwe) — garages’ own merchant accounts</h2>
  if (disabled) {
    return (
      <section aria-labelledby={`${uid}-title`} className="space-y-6 border-t pt-6" data-testid="paynow-operator">
        {title}
        <p className="text-sm text-gray-700" data-testid="paynow-op-disabled">{PAY05_NOT_OFFERED}</p>
      </section>
    )
  }
  return (
    <section aria-labelledby={`${uid}-title`} className="space-y-6 border-t pt-6" data-testid="paynow-operator">
      {title}
      {loadError && <p role="alert" className="rounded-md bg-red-50 p-3 text-red-900">{loadError}</p>}
      {message && <p role={message.ok ? 'status' : 'alert'} className={`rounded-md p-3 ${message.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`} data-testid="paynow-op-message">{message.text}</p>}

      {availability && (
        <div className="space-y-2 rounded-md border p-3" data-testid="paynow-op-availability">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Paynow payments are {availability.available ? 'on' : 'paused'}</span>
            {availability.simulator_enabled && <Badge variant="outline">Simulated Paynow (test environment)</Badge>}
            <Badge variant="outline">Real Paynow: {availability.real_enabled ? 'on' : 'off (needs an activation release)'}</Badge>
          </p>
          {availability.note && <p className="text-xs text-gray-700">Last change: {availability.note}</p>}
          <label htmlFor={`${uid}-avail`} className="block text-xs font-medium">Why are you changing it? (at least 10 characters)</label>
          <input id={`${uid}-avail`} value={availabilityNote} onChange={(e) => setAvailabilityNote(e.target.value)}
            className="w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid="paynow-op-availability-note" />
          <Button variant="outline" className="min-h-11" disabled={busy || availabilityNote.trim().length < 10}
            onClick={() => void act(() => setPaynowAvailability(!availability.available, availabilityNote.trim()).then(() => setAvailabilityNote('')),
              availability.available ? 'Paynow payments paused for every garage.' : 'Paynow payments resumed.')}
            data-testid="paynow-op-availability-toggle">
            {availability.available ? 'Pause Paynow payments' : 'Resume Paynow payments'}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="font-semibold">Merchant accounts</h3>
        {merchants?.length === 0 && <p className="text-sm text-gray-700">No garage has connected a Paynow account.</p>}
        <ul className="space-y-3">
          {merchants?.map((m) => {
            const r = review[m.id] ?? { legal: false, settlement: false, currency: false, note: '' }
            // all three human reviews and a note; the server then proves every key with Paynow
            const reviewed = r.legal && r.settlement && r.currency && r.note.trim().length >= 10
            return (
              <li key={m.id} className="space-y-2 rounded-md border p-3" data-testid="paynow-op-merchant" data-status={m.status}>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.garage_name ?? 'Garage'} — {m.display_name}</span>
                  <Badge variant="outline" className="whitespace-normal">{MERCHANT_STATUS_LABEL[m.status]}</Badge>
                </p>
                {m.profile && (
                  <dl className="grid gap-1 text-sm sm:grid-cols-2">
                    <div><dt className="inline font-medium">Legal name: </dt><dd className="inline">{m.profile.legal_entity_name}{m.profile.registration_number ? ` (${m.profile.registration_number})` : ''}</dd></div>
                    <div><dt className="inline font-medium">Settles to: </dt><dd className="inline">{m.profile.settlement_bank_name} ·· {m.profile.settlement_account_last4} ({m.profile.settlement_account_holder})</dd></div>
                    <div className="sm:col-span-2"><dt className="inline font-medium">Attested by: </dt><dd className="inline">{m.profile.attested_by} on {new Date(m.profile.attested_at).toLocaleString()}</dd></div>
                  </dl>
                )}
                <ul className="space-y-1 text-sm">
                  {m.integrations.map((i) => (
                    <li key={i.id} className="rounded border bg-gray-50 p-2">
                      {CURRENCY_NAME[i.currency] ?? i.currency}: integration {i.integration_id} ({i.mode}) · {i.methods.map((x) => PAYNOW_METHOD_LABEL[x]).join(', ')}
                      {' '}· key <code>{i.credential_fingerprint}</code> · {MERCHANT_STATUS_LABEL[i.status]}{i.probe ? ` · key check: ${i.probe.result}` : ''}
                    </li>
                  ))}
                </ul>
                {m.status === 'pending_verification' && (
                  <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3" role="group" aria-label={`Review ${m.display_name}`}>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" className="h-5 w-5" checked={r.legal} onChange={(e) => setReview({ ...review, [m.id]: { ...r, legal: e.target.checked } })}
                        data-testid="paynow-op-legal" />
                      The legal name matches this garage’s registered business
                    </label>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" className="h-5 w-5" checked={r.settlement} onChange={(e) => setReview({ ...review, [m.id]: { ...r, settlement: e.target.checked } })}
                        data-testid="paynow-op-settlement" />
                      The settlement account belongs to this garage
                    </label>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" className="h-5 w-5" checked={r.currency} onChange={(e) => setReview({ ...review, [m.id]: { ...r, currency: e.target.checked } })}
                        data-testid="paynow-op-currency" />
                      I checked each integration’s currency in the garage’s Paynow account (Paynow does not tell CarUp the currency)
                    </label>
                    <label htmlFor={`${uid}-note-${m.id}`} className="block text-xs font-medium">Review note (at least 10 characters)</label>
                    <input id={`${uid}-note-${m.id}`} value={r.note} onChange={(e) => setReview({ ...review, [m.id]: { ...r, note: e.target.value } })}
                      className="w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid="paynow-op-note" />
                    <div className="flex flex-wrap gap-2">
                      <Button className={`min-h-11 ${MONEY_ACTION_BUTTON_CLASS}`} disabled={busy || !reviewed}
                        onClick={() => void act(() => verifyPaynowMerchant(m.id, { legal_identity_reviewed: r.legal, settlement_account_reviewed: r.settlement,
                          currency_configuration_reviewed: r.currency, note: r.note.trim() }),
                          'Verified: every integration key proved itself with Paynow. Customers can now pay this garage through it.')}
                        data-testid="paynow-op-verify">
                        Check keys with Paynow and verify
                      </Button>
                    </div>
                    {reasonInput(`reject-${m.id}`, 'Reason to reject')}
                    <Button variant="outline" className="min-h-11 bg-white" disabled={busy || reasonOf(`reject-${m.id}`).length < 10}
                      onClick={() => void act(() => rejectPaynowMerchant(m.id, reasonOf(`reject-${m.id}`)), 'Rejected. The garage can connect again with correct details.')}
                      data-testid="paynow-op-reject">
                      Reject
                    </Button>
                  </div>
                )}
                {m.status === 'verified' && (
                  <div className="space-y-2">
                    {reasonInput(`suspend-${m.id}`, 'Reason to suspend')}
                    <Button variant="outline" className="min-h-11" disabled={busy || reasonOf(`suspend-${m.id}`).length < 10}
                      onClick={() => void act(() => suspendPaynowMerchant(m.id, reasonOf(`suspend-${m.id}`)), 'Suspended. No customer can pay through it.')}
                      data-testid="paynow-op-suspend">
                      Suspend
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">Paynow requests still holding invoice room</h3>
        <p className="text-sm text-gray-700">
          Paynow cannot cancel a payment request. A stopped or expired request keeps its room until Paynow closes it, or until you release it after Paynow shows it unpaid in a fresh check.
          If it is paid later, CarUp never counts it twice: it becomes money for review.
        </p>
        {held?.length === 0 && <p className="text-sm text-gray-700" data-testid="paynow-op-held-empty">Nothing is held.</p>}
        <ul className="space-y-2">
          {held?.map((h) => (
            <li key={h.collection_id} className="space-y-2 rounded-md border p-3" data-testid="paynow-op-held">
              <p>{h.garage ?? 'Garage'} · invoice {h.invoice_number ?? '—'} · {formatMoney(h.amount, h.currency)} · {PAYNOW_METHOD_LABEL[h.paynow.method]}</p>
              <p className="text-sm text-gray-700">{h.paynow.provider_status_label}{h.stopped_at ? ' · stopped by a person' : ' · past CarUp’s time'}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-11" disabled={busy}
                  onClick={() => void act(() => reconcilePaynowCollection(h.collection_id), 'Checked with Paynow.')} data-testid="paynow-op-held-check">
                  Check with Paynow
                </Button>
              </div>
              {reasonInput(`release-${h.collection_id}`, 'Reason to release the hold')}
              <Button className={`min-h-11 ${MONEY_ACTION_BUTTON_CLASS}`} disabled={busy || reasonOf(`release-${h.collection_id}`).length < 10}
                onClick={() => void act(() => releasePaynowHold(h.collection_id, reasonOf(`release-${h.collection_id}`)),
                  'Released after a fresh check with Paynow. The invoice room is free; a late payment would be reviewed, never counted twice.')}
                data-testid="paynow-op-release">
                Check with Paynow and release the hold
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Recent Paynow provider errors</h3>
        {errors?.length === 0 && <p className="text-sm text-gray-700">No provider errors.</p>}
        <ol className="space-y-1 text-sm" data-testid="paynow-op-errors">
          {errors?.slice(0, 50).map((e) => (
            <li key={e.id} className="rounded border bg-gray-50 p-2">
              {new Date(e.created_at).toLocaleString()} · {PROVIDER_ERROR_LABEL[e.kind] ?? e.kind}
              {e.collection_id ? ` · payment ${e.collection_id.slice(0, 8)}` : ''}
              {typeof e.detail?.provider_error === 'string' ? ` · Paynow said: “${e.detail.provider_error}”` : ''}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
