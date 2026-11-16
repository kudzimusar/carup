/**
 * RX03-P2-R4 — Gutu AI (the Addendum 05 "Ask CarUp" panel, renamed and extended).
 *
 * Describe the car in your own words — typed, or spoken through the BROWSER's own speech service —
 * see exactly what Gutu understood (and correct it), see the real published cars that match, and
 * read advisory guidance.
 *
 * Real capability, stated plainly in the UI:
 *  - the filters come from the governed taxonomy (lib/askCarUp) and map only to filters the
 *    Marketplace already applies (make, model, body, fuel, gearbox, colour, budget, town);
 *  - matches are a live read of GET /api/marketplace/listings with those filters — a failed read
 *    says so and is never shown as "no match";
 *  - guidance comes from POST /api/marketplace/ai/buyer-assistant, which answers with AI only when
 *    a provider is configured and with rules-based guidance otherwise; the panel says which;
 *  - voice is English only, via the browser (Chrome sends audio to Google); chiShona and isiNdebele
 *    are typed only and are not translated (RX-04 R4-08 owns governed multilingual AI).
 * AI output is advice: it never verifies a vehicle or creates Trust.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Loader2, Mic, Square, X } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { marketplaceHrefFor, parseCarRequest, understoodChips, withoutChip, type CarRequest } from '@/lib/askCarUp'
import { paramsToState, stateToApiFilters } from '@/lib/marketplaceParams'
import { GUTU_LANGUAGES, gutuLanguage, useGutuVoice, type GutuLanguage } from '@/lib/gutuVoice'
import { AskCarUpMark } from './AskCarUpMark'

const EXAMPLES = [
  'An automatic diesel pickup under $25,000 for the farm',
  'A white fuel-efficient hatchback for Harare traffic, around $8k',
  'A 7 seater for the family, petrol, under $15k',
]

type Guidance = { lines: string[]; aiAvailable: boolean } | null
type MatchCar = { vin: string; year: number | null; make: string; model: string; price: number | null; currency: string | null }
type Matches =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; total: number; cars: MatchCar[] }
  | { state: 'unavailable' }

const FOCUS_DARK = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09122A]'

function money(price: number | null, currency: string | null) {
  if (price === null || price === undefined) return 'Price on request'
  return `${currency || 'USD'} ${Number(price).toLocaleString('en-US')}`
}

export function AskCarUp({ initialQuery = '' }: { initialQuery?: string }) {
  const { marketplaceAiBuyerAssistant, fetchMarketplaceListings } = useCarUpApi()
  const inputId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(initialQuery)
  const [language, setLanguage] = useState<GutuLanguage>('en')
  const [request, setRequest] = useState<CarRequest | null>(null)
  const [guidance, setGuidance] = useState<Guidance>(null)
  const [matches, setMatches] = useState<Matches>({ state: 'idle' })
  const [state, setState] = useState<'idle' | 'asking' | 'answered'>('idle')
  const onTranscript = useCallback((heard: string) => setText(heard), [])
  const voice = useGutuVoice(language, onTranscript)
  const languageInfo = gutuLanguage(language)

  // Live matches for whatever Gutu currently understands (re-read when a chip is removed).
  useEffect(() => {
    if (!request) return
    let active = true
    const query = marketplaceHrefFor(request).split('?')[1] ?? ''
    const filters = { ...stateToApiFilters(paramsToState(new URLSearchParams(query))), limit: 3 }
    setMatches({ state: 'loading' })
    Promise.resolve()
      .then(() => fetchMarketplaceListings(filters as Record<string, string | number | boolean | undefined>))
      .then(res => {
        if (!active) return
        const listings = Array.isArray(res?.listings) ? res.listings : []
        const total = typeof res?.total === 'number' ? res.total : listings.length
        setMatches({
          state: 'ready',
          total,
          cars: listings.slice(0, 3).map(l => ({ vin: l.vin, year: l.year, make: l.make, model: l.model, price: l.price, currency: l.currency })),
        })
      })
      .catch(() => { if (active) setMatches({ state: 'unavailable' }) })
    return () => { active = false }
  }, [request, fetchMarketplaceListings])

  const ask = async (sentence: string) => {
    const value = sentence.trim()
    if (!value) { inputRef.current?.focus(); return }
    if (voice.state === 'listening') voice.stop()
    const parsed = parseCarRequest(value)
    setRequest(parsed)
    setState('asking')
    try {
      const res = await marketplaceAiBuyerAssistant({ budget: parsed.maxPrice, use_case: value })
      setGuidance({ lines: Array.isArray(res?.guidance) ? res.guidance.slice(0, 4) : [], aiAvailable: res?.ai_available === true })
    } catch {
      setGuidance({ lines: ['Ask the seller through CarUp, request an inspection before paying, and never pay outside CarUp.'], aiAvailable: false })
    } finally {
      setState('answered')
    }
  }

  const chips = request ? understoodChips(request) : []
  const href = request ? marketplaceHrefFor(request) : '/marketplace'
  const filtered = chips.some(chip => chip.key !== 'purpose')

  return (
    <section id="ask-carup" className="relative scroll-mt-20 overflow-hidden bg-[#F6F4F0] py-14 sm:py-20" data-testid="home-ask-carup" aria-labelledby="ask-carup-title">
      <div className="section-padding mx-auto grid max-w-[1440px] gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:gap-16">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]" data-testid="gutu-brand">
            <AskCarUpMark size={20} /> Gutu AI
          </p>
          <h2 id="ask-carup-title" className="mt-3 max-w-xl text-[clamp(1.75rem,3.4vw,3rem)] font-bold leading-[1.04] tracking-[-0.03em] text-[#09122A]">
            Say what the car is for. Gutu turns it into a search.
          </h2>
          <p className="mt-3 max-w-lg text-[15px] leading-7 text-slate-600">
            Describe it the way you would to a friend — type it, or speak it. You see exactly what Gutu understood, correct it, and get real published cars plus what to check before you pay.
          </p>

          <fieldset className="mt-6" data-testid="gutu-language">
            <legend className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-600">Language</legend>
            <div className="mt-2 inline-flex flex-wrap gap-1 rounded-full bg-white p-1 ring-1 ring-[#09122A]/10">
              {GUTU_LANGUAGES.map(l => (
                <label
                  key={l.code}
                  className={`relative inline-flex min-h-11 cursor-pointer items-center rounded-full px-4 text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#C2410C] ${language === l.code ? 'bg-[#09122A] text-white' : 'text-[#09122A] hover:bg-[#09122A]/5'}`}
                >
                  <input
                    type="radio"
                    name="gutu-language"
                    value={l.code}
                    checked={language === l.code}
                    onChange={() => setLanguage(l.code)}
                    className="sr-only"
                    lang={l.code}
                  />
                  <span lang={l.code}>{l.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 max-w-lg text-[13px] leading-5 text-slate-600" data-testid="gutu-language-capability">{languageInfo.capability}</p>
          </fieldset>

          <form
            className="carup-ask-field mt-5 rounded-[1.6rem] bg-white p-2 shadow-[0_1px_2px_rgba(9,18,42,0.06),0_24px_50px_-28px_rgba(9,18,42,0.35)]"
            onSubmit={event => { event.preventDefault(); void ask(text) }}
            data-testid="ask-carup-form"
          >
            <label htmlFor={inputId} className="sr-only">Describe the car you need</label>
            <textarea
              id={inputId}
              ref={inputRef}
              rows={2}
              lang={language}
              value={text}
              onChange={event => setText(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(text) } }}
              placeholder={language === 'en' ? 'e.g. a white automatic Toyota SUV under $30,000 in Harare' : 'Type your request — car names, prices and towns are recognised'}
              className="block w-full resize-none rounded-2xl border-0 bg-transparent px-4 py-3 text-[17px] leading-7 text-[#09122A] placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]"
              data-testid="ask-carup-input"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1">
              {voice.state === 'listening' ? (
                <button
                  type="button"
                  onClick={voice.stop}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#C2410C] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09122A] focus-visible:ring-offset-2"
                  data-testid="gutu-voice-stop"
                >
                  <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={voice.start}
                  disabled={!voice.available}
                  title={!voice.available ? (voice.supported ? 'Voice is not available in this language yet' : 'Voice input is not supported in this browser') : undefined}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-[#09122A] ring-1 ring-[#09122A]/15 transition hover:bg-[#09122A]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] disabled:cursor-not-allowed disabled:text-slate-500 disabled:ring-[#09122A]/10"
                  data-testid="gutu-voice-start"
                >
                  <Mic className="h-4 w-4" aria-hidden="true" /> {voice.state === 'heard' || voice.state === 'no-speech' ? 'Speak again' : 'Speak'}
                </button>
              )}
              <button
                type="submit"
                disabled={state === 'asking'}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-[#09122A] pl-2 pr-5 text-sm font-semibold text-white transition hover:bg-[#111D3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2 disabled:opacity-70"
                data-testid="ask-carup-submit"
              >
                {state === 'asking' ? <Loader2 className="ml-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <AskCarUpMark size={28} />}
                Ask Gutu
              </button>
            </div>
          </form>
          <p className="mt-2 min-h-5 text-[13px] leading-5 text-slate-700" role="status" aria-live="polite" data-testid="gutu-voice-status">
            {voice.message || (voice.available ? '' : !voice.supported ? 'Voice input is not supported in this browser. Type your request instead.' : '')}
          </p>
          <p className="mt-1 max-w-lg text-[12px] leading-5 text-slate-600">
            Voice uses your browser’s own speech service (in Chrome, audio is processed by Google). CarUp does not record it. Advice only · searches real published cars.
          </p>

          <div className="mt-4 flex flex-wrap gap-2" aria-label="Try an example">
            {EXAMPLES.map(example => (
              <button
                key={example}
                type="button"
                onClick={() => { setText(example); void ask(example) }}
                className="min-h-11 rounded-full bg-white/70 px-4 py-2 text-left text-[13px] font-medium text-[#09122A] ring-1 ring-[#09122A]/10 transition hover:bg-white hover:ring-[#09122A]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]"
                data-testid="ask-carup-example"
              >
                “{example}”
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 rounded-[1.75rem] bg-[#09122A] p-6 text-white sm:p-8" data-testid="ask-carup-answer" aria-live="polite">
          {state === 'idle' && (
            <ol className="space-y-6">
              {[
                ['Understands your words', 'Make, model, body, fuel, gearbox, colour, budget and town — from the same vehicle catalogue the Marketplace uses.'],
                ['Searches real listings', 'Only published cars. If nothing matches, it says so instead of showing something else.'],
                ['Tells you what to check', 'Advice for this kind of purchase. It cannot verify a car — the Passport and inspections do that.'],
              ].map(([title, copy], index) => (
                <li key={title} className="grid grid-cols-[2rem_1fr] gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm font-semibold tabular-nums text-[#FFB27A]">{index + 1}</span>
                  <div>
                    <p className="font-semibold tracking-[-0.01em]">{title}</p>
                    <p className="mt-1 text-[14px] leading-6 text-white/75">{copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {state === 'asking' && (
            <p className="flex items-center gap-3 text-[15px] text-white/80" role="status" data-testid="ask-carup-asking">
              <Loader2 className="h-5 w-5 animate-spin text-[#FFB27A]" aria-hidden="true" /> Reading your request…
            </p>
          )}

          {state === 'answered' && request && (
            <div data-testid="ask-carup-result">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFB27A]">What Gutu understood</p>
              {chips.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2" data-testid="ask-carup-understood">
                  {chips.map(chip => (
                    <li key={`${chip.key}-${chip.label}`}>
                      <button
                        type="button"
                        onClick={() => setRequest(current => (current ? withoutChip(current, chip) : current))}
                        className={`inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/10 pl-3 pr-2 text-[13px] font-medium ring-1 ring-white/15 transition hover:bg-white/15 ${FOCUS_DARK}`}
                        aria-label={`Remove ${chip.label}`}
                      >
                        {chip.label} <X className="h-3.5 w-3.5 text-white/70" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[14px] leading-6 text-white/75" data-testid="ask-carup-nothing-understood">
                  Gutu did not recognise a make, body style, fuel, gearbox, colour, budget or town in that. Try adding one — or browse everything.
                </p>
              )}

              <div className="mt-5 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10" data-testid="gutu-matches">
                {matches.state === 'loading' && (
                  <p className="flex items-center gap-2 text-[14px] text-white/80" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching published cars…</p>
                )}
                {matches.state === 'unavailable' && (
                  <p className="text-[14px] leading-6 text-white/80" data-testid="gutu-matches-unavailable">Gutu could not search the listings right now. That is not a “no match” — try again, or browse the Marketplace.</p>
                )}
                {matches.state === 'ready' && matches.total === 0 && (
                  <p className="text-[14px] leading-6 text-white/80" data-testid="gutu-matches-none">
                    No published car matches all of this yet. Remove a filter above to widen the search, or browse everything.
                  </p>
                )}
                {matches.state === 'ready' && matches.total > 0 && (
                  <>
                    <p className="text-[14px] font-semibold" data-testid="gutu-matches-count">
                      {matches.total} published car{matches.total === 1 ? '' : 's'} match{matches.total === 1 ? 'es' : ''}
                    </p>
                    <ul className="mt-2 divide-y divide-white/10">
                      {matches.cars.map(car => (
                        <li key={car.vin}>
                          <Link to={`/marketplace/${encodeURIComponent(car.vin)}`} className={`flex min-h-11 items-center justify-between gap-3 rounded-lg py-2 text-[14px] hover:text-[#FFB27A] ${FOCUS_DARK}`} data-testid="gutu-match">
                            <span className="min-w-0 truncate">{[car.year, car.make, car.model].filter(Boolean).join(' ')}</span>
                            <span className="shrink-0 tabular-nums text-white/75">{money(car.price, car.currency)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <Link
                  to={href}
                  className="mt-4 inline-flex h-12 items-center gap-2 rounded-full bg-[linear-gradient(90deg,#FE7D18,#FD5B0D)] px-6 text-sm font-semibold text-[#09122A] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#09122A]"
                  data-testid="ask-carup-show-cars"
                >
                  {filtered && matches.state === 'ready' && matches.total > 0 ? `Show all ${matches.total} in the Marketplace` : filtered ? 'Show matching cars' : 'Browse all published cars'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>

              {guidance && guidance.lines.length > 0 && (
                <div className="mt-7 border-t border-white/10 pt-5" data-testid="ask-carup-guidance">
                  <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                    <AskCarUpMark size={18} />
                    {guidance.aiAvailable ? 'Gutu AI · advice' : 'Gutu guidance · rules-based (AI not connected)'}
                  </p>
                  <ul className="mt-3 space-y-2.5">
                    {guidance.lines.map(line => (
                      <li key={line} className="grid grid-cols-[0.75rem_1fr] gap-2 text-[14px] leading-6 text-white/85">
                        <span className="mt-2.5 h-1.5 w-1.5 rounded-full bg-[#FE7D18]" aria-hidden="true" />{line}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-[12px] leading-5 text-white/65">
                    Advice only. Gutu AI cannot verify a vehicle, approve a deal or create Trust evidence.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
