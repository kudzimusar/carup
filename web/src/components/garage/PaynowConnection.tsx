import { useCallback, useEffect, useId, useState, type CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { MONEY_ACTION_BUTTON_CLASS, pay04ErrorText } from '@/lib/pay04GaragePayments'
import {
  CURRENCY_NAME, MERCHANT_STATUS_LABEL, PAYNOW_METHOD_LABEL, pay05ErrorText, type GaragePaynowConnection, type PaynowMethod,
} from '@/lib/pay05Paynow'

type CurrencyDraft = { enabled: boolean; integrationId: string; key: string; methods: PaynowMethod[] }
const CURRENCIES: Array<'USD' | 'ZWG'> = ['USD', 'ZWG']
/**
 * The integration key is a credential, not the garage administrator's password. A type="password" field makes browsers
 * and password managers offer to save it (and fill it elsewhere), so the key is plain text that the managers are told to
 * ignore, masked on screen with -webkit-text-security.
 */
const MASKED: CSSProperties & { WebkitTextSecurity: string } = { WebkitTextSecurity: 'disc' }
const IGNORED_BY_PASSWORD_MANAGERS = { 'data-1p-ignore': true, 'data-lpignore': 'true', 'data-bwignore': true, 'data-form-type': 'other' } as const
const blank = (currency: 'USD' | 'ZWG'): CurrencyDraft => ({ enabled: currency === 'USD', integrationId: '', key: '', methods: ['web'] })
const errorText = (err: unknown, fallback: string) => {
  const message = err instanceof Error ? err.message : ''
  return (message && (pay05ErrorText(message) ?? pay04ErrorText(message))) || fallback
}

/**
 * CARUP-PAY-05 — the garage connects its OWN Paynow merchant account (garage administrator).
 *
 * The customer's money goes straight to the garage's Paynow account and its settlement bank account — never through
 * CarUp. Each currency is its own Paynow integration (Paynow does not convert currencies). The integration key is sent
 * once over HTTPS, sealed by the server and never shown again: only a short fingerprint. CarUp verifies the account
 * before any customer can pay through it.
 */
export default function PaynowConnection() {
  const { fetchGaragePaynowConnection, connectGaragePaynow, disconnectGaragePaynow } = useCarUpApi()
  const uid = useId()
  const [data, setData] = useState<GaragePaynowConnection | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [form, setForm] = useState({ display_name: '', legal_entity_name: '', registration_number: '', settlement_bank_name: '',
    settlement_account_last4: '', settlement_account_holder: '', attest: false })
  const [drafts, setDrafts] = useState<Record<'USD' | 'ZWG', CurrencyDraft>>({ USD: blank('USD'), ZWG: blank('ZWG') })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [disconnectAsk, setDisconnectAsk] = useState(false)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetchGaragePaynowConnection()
      if (!res || typeof res.enabled !== 'boolean') throw new Error('Unexpected Paynow connection response')
      setData(res)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [fetchGaragePaynowConnection])
  useEffect(() => { void load() }, [load])

  const setDraft = (currency: 'USD' | 'ZWG', patch: Partial<CurrencyDraft>) => setDrafts((d) => ({ ...d, [currency]: { ...d[currency], ...patch } }))
  const toggleMethod = (currency: 'USD' | 'ZWG', method: PaynowMethod) => setDraft(currency, {
    methods: drafts[currency].methods.includes(method) ? drafts[currency].methods.filter((m) => m !== method) : [...drafts[currency].methods, method],
  })

  const connect = async () => {
    setBusy(true)
    setMessage(null)
    const integrations = CURRENCIES.filter((c) => drafts[c].enabled).map((c) => ({
      currency: c, integration_id: drafts[c].integrationId.trim(), integration_key: drafts[c].key, methods: drafts[c].methods,
    }))
    // the keys leave the page once: clear them from memory whatever the answer
    setDrafts((d) => ({ USD: { ...d.USD, key: '' }, ZWG: { ...d.ZWG, key: '' } }))
    try {
      setData(await connectGaragePaynow({ ...form, integrations }))
      setMessage({ ok: true, text: 'Your Paynow account is connected and waiting for CarUp to verify it. Customers can pay through it once it is verified.' })
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, 'The Paynow account could not be connected. Nothing was saved.') })
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setMessage(null)
    try {
      setData(await disconnectGaragePaynow(reason.trim()))
      setDisconnectAsk(false)
      setReason('')
      setMessage({ ok: true, text: 'Your Paynow account is disconnected. Customers can no longer pay through it on CarUp.' })
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, 'The Paynow account could not be disconnected. Nothing changed.') })
    } finally {
      setBusy(false)
    }
  }

  const merchant = data?.merchant
  const live = merchant && (merchant.status === 'pending_verification' || merchant.status === 'verified')
  const anyCurrency = CURRENCIES.some((c) => drafts[c].enabled)
  const complete = anyCurrency && form.attest && form.display_name.trim() && form.legal_entity_name.trim() && form.settlement_bank_name.trim()
    && /^\d{4}$/.test(form.settlement_account_last4) && form.settlement_account_holder.trim()
    && CURRENCIES.every((c) => !drafts[c].enabled || (/^\d{1,12}$/.test(drafts[c].integrationId.trim()) && drafts[c].key.length >= 16 && drafts[c].methods.length > 0))
  const field = (name: keyof typeof form, label: string, extra: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`${uid}-${name}`} className="block text-sm font-medium">{label}</label>
      <input id={`${uid}-${name}`} value={String(form[name])} onChange={(e) => setForm({ ...form, [name]: e.target.value })}
        className="mt-1 w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid={`paynow-connect-${name}`} {...extra} />
    </div>
  )

  return (
    <section aria-labelledby={`${uid}-title`} className="space-y-3 border-t pt-6" data-testid="garage-paynow-section">
      <h2 id={`${uid}-title`} className="text-lg font-semibold">Paynow — take online payments into your own account</h2>
      <p className="text-sm text-gray-700">
        Customers pay your garage through your own Paynow merchant account; Paynow settles to your own bank account. CarUp never receives or holds this money.
      </p>
      {state === 'loading' && <p role="status">Loading your Paynow connection…</p>}
      {state === 'error' && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-red-900" data-testid="garage-paynow-error">
          <p>Your Paynow connection could not be loaded. This does not mean it is connected or disconnected.</p>
          <Button variant="outline" className="mt-2 min-h-11" onClick={() => { setState('loading'); void load() }}>Try again</Button>
        </div>
      )}
      {message && <p role={message.ok ? 'status' : 'alert'} className={`rounded-md p-3 ${message.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`} data-testid="garage-paynow-message">{message.text}</p>}
      {state === 'ready' && data && (
        <>
          {data.mode === 'simulator' && (
            <Badge variant="outline" className="whitespace-normal" data-testid="garage-paynow-simulated">
              Test environment: this connects to a simulated Paynow. No real money moves.
            </Badge>
          )}
          {!data.availability.available && <p className="rounded-md bg-amber-50 p-3 text-amber-900">CarUp has paused Paynow payments for now.</p>}
          {merchant && (
            <div className="rounded-md border p-3 space-y-2" data-testid="garage-paynow-merchant" data-status={merchant.status}>
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{merchant.display_name}</span>
                <Badge variant="outline" className="whitespace-normal" data-testid="garage-paynow-status">{MERCHANT_STATUS_LABEL[merchant.status]}</Badge>
              </p>
              {merchant.profile && (
                <p className="text-sm text-gray-700">
                  {merchant.profile.legal_entity_name} · settles to {merchant.profile.settlement_bank_name} account ending {merchant.profile.settlement_account_last4}
                </p>
              )}
              <ul className="space-y-1 text-sm" data-testid="garage-paynow-integrations">
                {merchant.integrations.map((i) => (
                  <li key={i.id} className="rounded border bg-gray-50 p-2">
                    {CURRENCY_NAME[i.currency] ?? i.currency}: integration {i.integration_id} · {i.methods.map((m) => PAYNOW_METHOD_LABEL[m]).join(', ')}
                    {' '}· key fingerprint <code>{i.credential_fingerprint}</code> · {MERCHANT_STATUS_LABEL[i.status]}
                  </li>
                ))}
              </ul>
              {merchant.suspended_reason && <p className="text-sm text-gray-700">Reason: {merchant.suspended_reason}</p>}
              <p className="text-xs text-gray-700" data-testid="garage-paynow-refunds">
                Refunds: Paynow does not let CarUp refund. Refund a customer in your Paynow dashboard; CarUp shows it when Paynow reports it.
              </p>
              {live && !disconnectAsk && (
                <Button variant="outline" className="min-h-11" onClick={() => setDisconnectAsk(true)} data-testid="garage-paynow-disconnect">Disconnect Paynow</Button>
              )}
              {live && disconnectAsk && (
                <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3" role="group" aria-label="Disconnect Paynow?">
                  <label htmlFor={`${uid}-reason`} className="block text-sm font-medium">Why are you disconnecting? (at least 10 characters)</label>
                  <input id={`${uid}-reason`} value={reason} onChange={(e) => setReason(e.target.value)}
                    className="w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid="garage-paynow-disconnect-reason" />
                  <div className="flex flex-wrap gap-2">
                    <Button className={`min-h-11 ${MONEY_ACTION_BUTTON_CLASS}`} disabled={busy || reason.trim().length < 10} onClick={() => void disconnect()}
                      data-testid="garage-paynow-disconnect-confirm">Disconnect</Button>
                    <Button variant="outline" className="min-h-11 bg-white" disabled={busy} onClick={() => setDisconnectAsk(false)}>Keep it connected</Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {data.can_connect && (
            <form className="space-y-3 rounded-md border p-3" onSubmit={(e) => { e.preventDefault(); void connect() }} data-testid="garage-paynow-connect">
              <p className="font-medium">Connect your Paynow merchant account</p>
              <p className="text-xs text-gray-700">
                In Paynow, open “Sell or Receive” → “Receive Payment Links” → “3rd Party Site or Link Profile”. Each currency is a separate integration with its own ID and key.
              </p>
              {field('display_name', 'Name customers see')}
              {field('legal_entity_name', 'Registered business name (as on your Paynow merchant account)')}
              {field('registration_number', 'Company registration number (optional)')}
              {field('settlement_bank_name', 'Settlement bank')}
              {field('settlement_account_last4', 'Last four digits of the settlement account', { inputMode: 'numeric', maxLength: 4 })}
              {field('settlement_account_holder', 'Settlement account holder name')}
              {CURRENCIES.map((c) => (
                <fieldset key={c} className="space-y-2 rounded-md border p-3" data-testid={`garage-paynow-currency-${c}`}>
                  <legend className="px-1 text-sm font-medium">{CURRENCY_NAME[c]}</legend>
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" className="h-5 w-5" checked={drafts[c].enabled} onChange={(e) => setDraft(c, { enabled: e.target.checked })}
                      data-testid={`paynow-connect-${c}-enabled`} />
                    Take {c === 'USD' ? 'US dollars' : 'ZiG'} through Paynow
                  </label>
                  {drafts[c].enabled && (
                    <>
                      <div>
                        <label htmlFor={`${uid}-${c}-id`} className="block text-sm font-medium">Integration ID</label>
                        <input id={`${uid}-${c}-id`} inputMode="numeric" value={drafts[c].integrationId} onChange={(e) => setDraft(c, { integrationId: e.target.value })}
                          className="mt-1 w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid={`paynow-connect-${c}-id`} />
                      </div>
                      <div>
                        <label htmlFor={`${uid}-${c}-key`} className="block text-sm font-medium">Integration key</label>
                        <input id={`${uid}-${c}-key`} type="text" autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off"
                          {...IGNORED_BY_PASSWORD_MANAGERS} style={MASKED} value={drafts[c].key}
                          onChange={(e) => setDraft(c, { key: e.target.value.trim() })} aria-describedby={`${uid}-${c}-key-hint`}
                          className="mt-1 w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 font-mono text-sm" data-testid={`paynow-connect-${c}-key`} />
                        <p id={`${uid}-${c}-key-hint`} className="mt-1 text-xs text-gray-700">
                          Sent once and never shown again: CarUp keeps only a short fingerprint of it.
                        </p>
                      </div>
                      <div role="group" aria-label={`Payment methods enabled on the ${c} integration`} className="flex flex-wrap gap-2">
                        {data.methods.filter((m) => m !== 'innbucks' || c === 'USD').map((m) => (
                          <label key={m} className="flex min-h-11 items-center gap-2 rounded border px-2">
                            <input type="checkbox" className="h-5 w-5" checked={drafts[c].methods.includes(m)} onChange={() => toggleMethod(c, m)}
                              data-testid={`paynow-connect-${c}-method-${m}`} />
                            {PAYNOW_METHOD_LABEL[m]}
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-gray-700">Tick only the methods your Paynow integration is set up for — Paynow refuses the others.</p>
                    </>
                  )}
                </fieldset>
              ))}
              <label className="flex min-h-11 items-start gap-2">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={form.attest} onChange={(e) => setForm({ ...form, attest: e.target.checked })}
                  data-testid="paynow-connect-attest" />
                <span className="text-sm">I confirm this Paynow merchant account and its settlement bank account belong to this garage, and that I may connect them to CarUp.</span>
              </label>
              <Button type="submit" className={`min-h-11 ${MONEY_ACTION_BUTTON_CLASS}`} disabled={busy || !complete} data-testid="paynow-connect-submit">
                {busy ? 'Connecting…' : 'Connect Paynow account'}
              </Button>
            </form>
          )}
          {!data.can_connect && !merchant && (
            <p className="text-sm text-gray-700" data-testid="garage-paynow-unavailable">Paynow connections are not available here yet.</p>
          )}
        </>
      )}
    </section>
  )
}
