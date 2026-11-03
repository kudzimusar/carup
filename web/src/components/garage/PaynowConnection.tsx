import { useCallback, useEffect, useId, useState, type CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { MONEY_ACTION_BUTTON_CLASS } from '@/lib/pay04GaragePayments'
import {
  CURRENCY_NAME, MERCHANT_STATUS_LABEL, PAY05_NOT_OFFERED, PAYNOW_METHOD_LABEL, isPay05Disabled, pay05ErrorText, paynowErrorText,
  type GaragePaynowConnection, type PaynowMethod,
} from '@/lib/pay05Paynow'

type Currency = 'USD' | 'ZWG'
type CurrencyDraft = { enabled: boolean; integrationId: string; key: string; methods: PaynowMethod[] }
const CURRENCIES: Currency[] = ['USD', 'ZWG']
type ProfileField = 'display_name' | 'legal_entity_name' | 'registration_number' | 'settlement_bank_name' | 'settlement_account_last4' | 'settlement_account_holder'
type ProfileForm = Record<ProfileField, string> & { attest: boolean }
type FieldKey = ProfileField | 'currencies' | `${Currency}-id` | `${Currency}-key` | `${Currency}-methods` | 'attest'
type Problems = Partial<Record<FieldKey, string>>
/** The fields in the order the form shows them: the first one with a problem gets the focus. */
const FIELD_ORDER: FieldKey[] = ['display_name', 'legal_entity_name', 'registration_number', 'settlement_bank_name', 'settlement_account_last4',
  'settlement_account_holder', 'currencies', 'USD-id', 'USD-key', 'USD-methods', 'ZWG-id', 'ZWG-key', 'ZWG-methods', 'attest']
const KEYS_CLEARED = 'For your security the keys were cleared — enter them again.'

/** The rules the server applies to a connection, checked on submit so that each problem is named next to its own field. */
function formProblems(form: ProfileForm, drafts: Record<Currency, CurrencyDraft>): Problems {
  const problems: Problems = {}
  const sized = (key: ProfileField, max: number, empty: string, short: string, long: string) => {
    const value = form[key].trim()
    if (!value) problems[key] = empty
    else if (value.length < 2) problems[key] = short
    else if (value.length > max) problems[key] = long
  }
  sized('display_name', 120, 'Enter the name customers see.', 'Use at least 2 characters for the name customers see.',
    'Use at most 120 characters for the name customers see.')
  sized('legal_entity_name', 160, 'Enter the registered business name.', 'Use at least 2 characters for the registered business name.',
    'Use at most 160 characters for the registered business name.')
  const registration = form.registration_number.trim()
  if (registration && !/^[A-Za-z0-9/ .-]{2,40}$/.test(registration)) problems.registration_number = pay05ErrorText('PAY05_REGISTRATION_NUMBER_INVALID') ?? ''
  sized('settlement_bank_name', 80, 'Enter the settlement bank.', 'Use at least 2 characters for the settlement bank.',
    'Use at most 80 characters for the settlement bank.')
  if (!/^\d{4}$/.test(form.settlement_account_last4.trim())) problems.settlement_account_last4 = pay05ErrorText('PAY05_SETTLEMENT_ACCOUNT_INVALID') ?? ''
  sized('settlement_account_holder', 160, 'Enter the name of the settlement account holder.', 'Use at least 2 characters for the account holder.',
    'Use at most 160 characters for the account holder.')
  if (!CURRENCIES.some((c) => drafts[c].enabled)) problems.currencies = 'Choose at least one currency to take through Paynow.'
  for (const c of CURRENCIES) {
    if (!drafts[c].enabled) continue
    if (!/^\d{1,12}$/.test(drafts[c].integrationId.trim())) problems[`${c}-id`] = pay05ErrorText('PAY05_INTEGRATION_ID_INVALID') ?? ''
    if (drafts[c].key.length < 16) problems[`${c}-key`] = 'The integration key is at least 16 characters — paste it exactly as Paynow e-mailed it.'
    if (!drafts[c].methods.length) problems[`${c}-methods`] = pay05ErrorText('PAY05_METHODS_INVALID') ?? ''
  }
  if (!form.attest) problems.attest = 'Confirm that this Paynow merchant account and its settlement bank account belong to this garage.'
  return problems
}

/** The fields a server refusal is about (an ID, key or method refusal names no currency, so it marks every one being connected). */
function refusedFields(code: string | undefined, connecting: Currency[]): FieldKey[] {
  switch (code) {
    case 'PAY05_REGISTRATION_NUMBER_INVALID': return ['registration_number']
    case 'PAY05_SETTLEMENT_ACCOUNT_INVALID': return ['settlement_account_last4']
    case 'PAY05_ATTESTATION_REQUIRED': return ['attest']
    case 'PAY05_INTEGRATIONS_INVALID': return ['currencies']
    case 'PAY05_INTEGRATION_ID_INVALID': return connecting.map((c) => `${c}-id` as const)
    case 'PAY05_INTEGRATION_KEY_INVALID': return connecting.map((c) => `${c}-key` as const)
    case 'PAY05_METHODS_INVALID': return connecting.map((c) => `${c}-methods` as const)
    default: return []
  }
}
/**
 * The integration key is a credential, not the garage administrator's password. A type="password" field makes browsers
 * and password managers offer to save it (and fill it elsewhere), so the key is plain text that the managers are told to
 * ignore, masked on screen with -webkit-text-security.
 */
const MASKED: CSSProperties & { WebkitTextSecurity: string } = { WebkitTextSecurity: 'disc' }
const IGNORED_BY_PASSWORD_MANAGERS = { 'data-1p-ignore': true, 'data-lpignore': 'true', 'data-bwignore': true, 'data-form-type': 'other' } as const
const blank = (currency: Currency): CurrencyDraft => ({ enabled: currency === 'USD', integrationId: '', key: '', methods: ['web'] })

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
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'disabled'>('loading')
  const [form, setForm] = useState<ProfileForm>({ display_name: '', legal_entity_name: '', registration_number: '', settlement_bank_name: '',
    settlement_account_last4: '', settlement_account_holder: '', attest: false })
  const [drafts, setDrafts] = useState<Record<Currency, CurrencyDraft>>({ USD: blank('USD'), ZWG: blank('ZWG') })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [disconnectAsk, setDisconnectAsk] = useState(false)
  const [reason, setReason] = useState('')
  const [problems, setProblems] = useState<Problems>({})
  // set once the keys have left the page: the form says they were cleared until they are entered again
  const [keysCleared, setKeysCleared] = useState(false)
  // focus moves only after React has drawn what it points at (the field's message, the result)
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusId) return
    const el = document.getElementById(focusId)
    const target = el && !el.matches('input, select, textarea, button') ? el.querySelector<HTMLElement>('input, select, textarea, button') ?? el : el
    target?.focus()
    // the request is spent once focus has moved, so the same field can be asked for again
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusId(null)
  }, [focusId])

  const load = useCallback(async () => {
    try {
      const res = await fetchGaragePaynowConnection()
      if (!res || typeof res.enabled !== 'boolean') throw new Error('Unexpected Paynow connection response')
      setData(res)
      setState('ready')
    } catch (err) {
      // PAY-05 switched off is not a failure: the garage is simply not offered Paynow yet
      setState(isPay05Disabled(err) ? 'disabled' : 'error')
    }
  }, [fetchGaragePaynowConnection])
  // loading on mount is the effect's job: every state it sets is set after the request answers
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const fieldId = (key: FieldKey) => (key === 'currencies' ? `${uid}-USD-enabled` : `${uid}-${key}`)
  const errorId = (key: FieldKey) => `${uid}-${key}-error`
  /** a field the person changes is no longer marked wrong */
  const settle = (key: FieldKey) => setProblems((current) => {
    if (!(key in current)) return current
    const next = { ...current }
    delete next[key]
    return next
  })
  const setDraft = (currency: Currency, patch: Partial<CurrencyDraft>) => setDrafts((d) => ({ ...d, [currency]: { ...d[currency], ...patch } }))
  const toggleMethod = (currency: Currency, method: PaynowMethod) => {
    setDraft(currency, {
      methods: drafts[currency].methods.includes(method) ? drafts[currency].methods.filter((m) => m !== method) : [...drafts[currency].methods, method],
    })
    settle(`${currency}-methods`)
  }

  const connect = async () => {
    // checked before anything is sent; what was typed stays (the keys included) so it can be corrected
    const found = formProblems(form, drafts)
    const first = FIELD_ORDER.find((k) => found[k])
    if (first) {
      setProblems(found)
      setMessage(null)
      setFocusId(fieldId(first))
      return
    }
    setProblems({})
    setBusy(true)
    setMessage(null)
    const connecting = CURRENCIES.filter((c) => drafts[c].enabled)
    const integrations = connecting.map((c) => ({
      currency: c, integration_id: drafts[c].integrationId.trim(), integration_key: drafts[c].key, methods: drafts[c].methods,
    }))
    // the keys leave the page once: clear them from memory whatever the answer, and say so
    setDrafts((d) => ({ USD: { ...d.USD, key: '' }, ZWG: { ...d.ZWG, key: '' } }))
    setKeysCleared(true)
    try {
      const connected = await connectGaragePaynow({ ...form, integrations })
      setData(connected)
      setMessage({ ok: true, text: 'Your Paynow account is connected and waiting for CarUp to verify it. Customers can pay through it once it is verified.' })
      setFocusId(connected?.merchant ? `${uid}-status` : `${uid}-message`)
    } catch (err) {
      const code = /\bPAY05_[A-Z0-9_]+\b/.exec(err instanceof Error ? err.message : '')?.[0]
      const fields = refusedFields(code, connecting)
      const text = paynowErrorText(err, 'The Paynow account could not be connected. Nothing was saved.')
      if (fields.length) {
        setProblems(Object.fromEntries(fields.map((f) => [f, text])))
        setFocusId(fieldId(fields[0]))
        setMessage({ ok: false, text: 'The Paynow account was not connected and nothing was saved — see the marked field.' })
      } else {
        setMessage({ ok: false, text })
        setFocusId(`${uid}-message`)
      }
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const disconnected = await disconnectGaragePaynow(reason.trim())
      setData(disconnected)
      setDisconnectAsk(false)
      setReason('')
      setMessage({ ok: true, text: 'Your Paynow account is disconnected. Customers can no longer pay through it on CarUp.' })
      setFocusId(disconnected?.merchant ? `${uid}-status` : `${uid}-message`)
    } catch (err) {
      setMessage({ ok: false, text: paynowErrorText(err, 'The Paynow account could not be disconnected. Nothing changed.') })
      setFocusId(`${uid}-message`)
    } finally {
      setBusy(false)
    }
  }

  const merchant = data?.merchant
  const live = merchant && (merchant.status === 'pending_verification' || merchant.status === 'verified')
  const keysToEnter = keysCleared && CURRENCIES.some((c) => drafts[c].enabled && !drafts[c].key)
  /** the field's problem, next to it and named by aria-describedby */
  const problemOf = (key: FieldKey) => problems[key]
    ? <p id={errorId(key)} className="mt-1 text-sm text-red-800" data-testid={`paynow-connect-${key}-error`}>{problems[key]}</p>
    : null
  const describedBy = (key: FieldKey, ...others: string[]) => [...others, ...(problems[key] ? [errorId(key)] : [])].join(' ') || undefined
  const field = (name: ProfileField, label: string, extra: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`${uid}-${name}`} className="block text-sm font-medium">{label}</label>
      <input id={`${uid}-${name}`} value={form[name]} onChange={(e) => { setForm({ ...form, [name]: e.target.value }); settle(name) }}
        aria-invalid={problems[name] ? true : undefined} aria-describedby={describedBy(name)}
        className="mt-1 w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid={`paynow-connect-${name}`} {...extra} />
      {problemOf(name)}
    </div>
  )

  return (
    <section aria-labelledby={`${uid}-title`} className="space-y-3 border-t pt-6" data-testid="garage-paynow-section">
      <h2 id={`${uid}-title`} className="text-lg font-semibold">Paynow — take online payments into your own account</h2>
      <p className="text-sm text-gray-700">
        Customers pay your garage through your own Paynow merchant account; Paynow settles to your own bank account. CarUp never receives or holds this money.
      </p>
      {state === 'loading' && <p role="status">Loading your Paynow connection…</p>}
      {state === 'disabled' && <p className="text-sm text-gray-700" data-testid="garage-paynow-disabled">{PAY05_NOT_OFFERED}</p>}
      {state === 'error' && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-red-900" data-testid="garage-paynow-error">
          <p>Your Paynow connection could not be loaded. This does not mean it is connected or disconnected.</p>
          <Button variant="outline" className="mt-2 min-h-11" onClick={() => { setState('loading'); void load() }}>Try again</Button>
        </div>
      )}
      {/* in the page, empty, before its words arrive, so they are announced; it takes the focus after a refusal (W8) */}
      <p id={`${uid}-message`} role="status" aria-live="polite" tabIndex={-1}
        className={message ? `rounded-md p-3 ${message.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}` : ''}
        data-testid="garage-paynow-message">{message?.text ?? ''}</p>
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
                <Badge id={`${uid}-status`} tabIndex={-1} variant="outline" className="whitespace-normal" data-testid="garage-paynow-status">
                  {MERCHANT_STATUS_LABEL[merchant.status]}
                </Badge>
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
              {merchant.status === 'rejected' && (
                <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900" data-testid="garage-paynow-rejected">
                  {merchant.rejected_reason?.trim()
                    ? `Not verified — CarUp’s reason: ${merchant.rejected_reason.trim().replace(/[.\s]+$/, '')}. Connect again with correct details.`
                    : 'Not verified — connect again with correct details.'}
                </p>
              )}
              <p className="text-xs text-gray-700" data-testid="garage-paynow-refunds">
                Refunds: Paynow does not let CarUp refund. Refund a customer in your Paynow dashboard; CarUp shows it when Paynow reports it.
              </p>
              {live && !disconnectAsk && (
                <Button id={`${uid}-disconnect`} variant="outline" className="min-h-11" onClick={() => { setDisconnectAsk(true); setFocusId(`${uid}-reason`) }} data-testid="garage-paynow-disconnect">Disconnect Paynow</Button>
              )}
              {live && disconnectAsk && (
                <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3" role="group" aria-label="Disconnect Paynow?">
                  <label htmlFor={`${uid}-reason`} className="block text-sm font-medium">Why are you disconnecting? (at least 10 characters)</label>
                  <input id={`${uid}-reason`} value={reason} onChange={(e) => setReason(e.target.value)}
                    className="w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid="garage-paynow-disconnect-reason" />
                  <div className="flex flex-wrap gap-2">
                    <Button className={`min-h-11 ${MONEY_ACTION_BUTTON_CLASS}`} disabled={busy || reason.trim().length < 10} onClick={() => void disconnect()}
                      data-testid="garage-paynow-disconnect-confirm">Disconnect</Button>
                    <Button variant="outline" className="min-h-11 bg-white" disabled={busy} onClick={() => { setDisconnectAsk(false); setFocusId(`${uid}-disconnect`) }}>Keep it connected</Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {data.can_connect && (
            <form className="space-y-3 rounded-md border p-3" noValidate onSubmit={(e) => { e.preventDefault(); void connect() }} data-testid="garage-paynow-connect">
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
              {keysToEnter && (
                <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900" data-testid="garage-paynow-keys-cleared">{KEYS_CLEARED}</p>
              )}
              {CURRENCIES.map((c) => (
                <fieldset key={c} className="space-y-2 rounded-md border p-3" data-testid={`garage-paynow-currency-${c}`}>
                  <legend className="px-1 text-sm font-medium">{CURRENCY_NAME[c]}</legend>
                  <label className="flex min-h-11 items-center gap-2">
                    <input id={`${uid}-${c}-enabled`} type="checkbox" className="h-5 w-5" checked={drafts[c].enabled}
                      onChange={(e) => { setDraft(c, { enabled: e.target.checked }); settle('currencies') }}
                      aria-invalid={c === 'USD' && problems.currencies ? true : undefined}
                      aria-describedby={c === 'USD' ? describedBy('currencies') : undefined} data-testid={`paynow-connect-${c}-enabled`} />
                    Take {c === 'USD' ? 'US dollars' : 'ZiG'} through Paynow
                  </label>
                  {c === 'USD' && problemOf('currencies')}
                  {drafts[c].enabled && (
                    <>
                      <div>
                        <label htmlFor={`${uid}-${c}-id`} className="block text-sm font-medium">Integration ID</label>
                        <input id={`${uid}-${c}-id`} inputMode="numeric" value={drafts[c].integrationId}
                          onChange={(e) => { setDraft(c, { integrationId: e.target.value }); settle(`${c}-id`) }}
                          aria-invalid={problems[`${c}-id`] ? true : undefined} aria-describedby={describedBy(`${c}-id`)}
                          className="mt-1 w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" data-testid={`paynow-connect-${c}-id`} />
                        {problemOf(`${c}-id`)}
                      </div>
                      <div>
                        <label htmlFor={`${uid}-${c}-key`} className="block text-sm font-medium">Integration key</label>
                        <input id={`${uid}-${c}-key`} type="text" autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off"
                          {...IGNORED_BY_PASSWORD_MANAGERS} style={MASKED} value={drafts[c].key}
                          onChange={(e) => { setDraft(c, { key: e.target.value.trim() }); settle(`${c}-key`) }}
                          aria-invalid={problems[`${c}-key`] ? true : undefined} aria-describedby={describedBy(`${c}-key`, `${uid}-${c}-key-hint`)}
                          className="mt-1 w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 font-mono text-sm" data-testid={`paynow-connect-${c}-key`} />
                        <p id={`${uid}-${c}-key-hint`} className="mt-1 text-xs text-gray-700">
                          Sent once and never shown again: CarUp keeps only a short fingerprint of it.
                        </p>
                        {problemOf(`${c}-key`)}
                      </div>
                      <div id={`${uid}-${c}-methods`} role="group" aria-label={`Payment methods enabled on the ${c} integration`}
                        aria-describedby={describedBy(`${c}-methods`)} className="flex flex-wrap gap-2">
                        {data.methods.filter((m) => m !== 'innbucks' || c === 'USD').map((m) => (
                          <label key={m} className="flex min-h-11 items-center gap-2 rounded border px-2">
                            <input type="checkbox" className="h-5 w-5" checked={drafts[c].methods.includes(m)} onChange={() => toggleMethod(c, m)}
                              aria-invalid={problems[`${c}-methods`] ? true : undefined} aria-describedby={describedBy(`${c}-methods`)}
                              data-testid={`paynow-connect-${c}-method-${m}`} />
                            {PAYNOW_METHOD_LABEL[m]}
                          </label>
                        ))}
                      </div>
                      {problemOf(`${c}-methods`)}
                      <p className="text-xs text-gray-700">Tick only the methods your Paynow integration is set up for — Paynow refuses the others.</p>
                    </>
                  )}
                </fieldset>
              ))}
              <div>
                <label className="flex min-h-11 items-start gap-2">
                  <input id={`${uid}-attest`} type="checkbox" className="mt-1 h-5 w-5" checked={form.attest}
                    onChange={(e) => { setForm({ ...form, attest: e.target.checked }); settle('attest') }}
                    aria-invalid={problems.attest ? true : undefined} aria-describedby={describedBy('attest')} data-testid="paynow-connect-attest" />
                  <span className="text-sm">I confirm this Paynow merchant account and its settlement bank account belong to this garage, and that I may connect them to CarUp.</span>
                </label>
                {problemOf('attest')}
              </div>
              <Button type="submit" className={`min-h-11 ${MONEY_ACTION_BUTTON_CLASS}`} disabled={busy} data-testid="paynow-connect-submit">
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
