/**
 * RX03 Addendum 05 — Ask CarUp: describe the car in your own words, see exactly what CarUp
 * understood (and correct it), jump to the real filtered Marketplace, and read advisory guidance.
 *
 * Real capability: the filters come from the governed taxonomy (lib/askCarUp) and map only to
 * filters the Marketplace already applies; guidance comes from POST /api/marketplace/ai/buyer-assistant,
 * which returns AI guidance when a provider is configured and rules-based guidance otherwise. The
 * panel says which one it is. AI output is advice: it never verifies a vehicle or creates Trust.
 */
import { useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Loader2, X } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { marketplaceHrefFor, parseCarRequest, understoodChips, withoutChip, type CarRequest } from '@/lib/askCarUp'
import { AskCarUpMark } from './AskCarUpMark'

const EXAMPLES = [
  'An automatic diesel pickup under $25,000 for the farm',
  'A fuel-efficient hatchback for Harare traffic, around $8k',
  'A 7 seater for the family, petrol, under $15k',
]

type Guidance = { lines: string[]; aiAvailable: boolean } | null

export function AskCarUp({ initialQuery = '' }: { initialQuery?: string }) {
  const { marketplaceAiBuyerAssistant } = useCarUpApi()
  const inputId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(initialQuery)
  const [request, setRequest] = useState<CarRequest | null>(null)
  const [guidance, setGuidance] = useState<Guidance>(null)
  const [state, setState] = useState<'idle' | 'asking' | 'answered'>('idle')

  const ask = async (sentence: string) => {
    const value = sentence.trim()
    if (!value) { inputRef.current?.focus(); return }
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

  return (
    <section id="ask-carup" className="relative scroll-mt-20 overflow-hidden bg-[#F6F4F0] py-14 sm:py-20" data-testid="home-ask-carup" aria-labelledby="ask-carup-title">
      <div className="section-padding mx-auto grid max-w-[1440px] gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:gap-16">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]">
            <AskCarUpMark size={20} /> Ask CarUp
          </p>
          <h2 id="ask-carup-title" className="mt-3 max-w-xl text-[clamp(1.75rem,3.4vw,3rem)] font-bold leading-[1.04] tracking-[-0.03em] text-[#09122A]">
            Say what the car is for. CarUp turns it into a search.
          </h2>
          <p className="mt-3 max-w-lg text-[15px] leading-7 text-slate-600">
            Describe it the way you would to a friend. You see exactly what CarUp understood, correct it, and get real published cars plus what to check before you pay.
          </p>

          <form
            className="carup-ask-field mt-7 rounded-[1.6rem] bg-white p-2 shadow-[0_1px_2px_rgba(9,18,42,0.06),0_24px_50px_-28px_rgba(9,18,42,0.35)]"
            onSubmit={event => { event.preventDefault(); void ask(text) }}
            data-testid="ask-carup-form"
          >
            <label htmlFor={inputId} className="sr-only">Describe the car you need</label>
            <textarea
              id={inputId}
              ref={inputRef}
              rows={2}
              value={text}
              onChange={event => setText(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(text) } }}
              placeholder="e.g. an automatic diesel pickup under $25,000 for the farm"
              className="block w-full resize-none rounded-2xl border-0 bg-transparent px-4 py-3 text-[17px] leading-7 text-[#09122A] placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]"
              data-testid="ask-carup-input"
            />
            <div className="flex items-center justify-between gap-3 px-2 pb-1">
              <span className="text-[12px] text-slate-500">Advice only · searches real published cars</span>
              <button
                type="submit"
                disabled={state === 'asking'}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-[#09122A] pl-2 pr-5 text-sm font-semibold text-white transition hover:bg-[#111D3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2 disabled:opacity-70"
                data-testid="ask-carup-submit"
              >
                {state === 'asking' ? <Loader2 className="ml-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <AskCarUpMark size={28} />}
                Ask CarUp
              </button>
            </div>
          </form>

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
                ['Understands your words', 'Make, model, body, fuel, gearbox, budget and town — from the same vehicle catalogue the Marketplace uses.'],
                ['Searches real listings', 'Only published cars. If nothing matches, it says so instead of showing something else.'],
                ['Tells you what to check', 'Advice for this kind of purchase. It cannot verify a car — the Passport and inspections do that.'],
              ].map(([title, copy], index) => (
                <li key={title} className="grid grid-cols-[2rem_1fr] gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm font-semibold tabular-nums text-[#FFB27A]">{index + 1}</span>
                  <div>
                    <p className="font-semibold tracking-[-0.01em]">{title}</p>
                    <p className="mt-1 text-[14px] leading-6 text-white/70">{copy}</p>
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFB27A]">What CarUp understood</p>
              {chips.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2" data-testid="ask-carup-understood">
                  {chips.map(chip => (
                    <li key={`${chip.key}-${chip.label}`}>
                      <button
                        type="button"
                        onClick={() => setRequest(current => (current ? withoutChip(current, chip) : current))}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/10 pl-3 pr-2 text-[13px] font-medium ring-1 ring-white/15 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18]"
                        aria-label={`Remove ${chip.label}`}
                      >
                        {chip.label} <X className="h-3.5 w-3.5 text-white/60" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[14px] leading-6 text-white/70" data-testid="ask-carup-nothing-understood">
                  CarUp did not recognise a make, body style, fuel, gearbox, budget or town in that. Try adding one — or browse everything.
                </p>
              )}
              <Link
                to={href}
                className="mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-[linear-gradient(90deg,#FE7D18,#FD5B0D)] px-6 text-sm font-semibold text-[#09122A] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#09122A]"
                data-testid="ask-carup-show-cars"
              >
                {chips.some(chip => chip.key !== 'purpose') ? 'Show matching cars' : 'Browse all published cars'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>

              {guidance && guidance.lines.length > 0 && (
                <div className="mt-7 border-t border-white/10 pt-5" data-testid="ask-carup-guidance">
                  <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
                    <AskCarUpMark size={18} />
                    {guidance.aiAvailable ? 'CarUp AI · advice' : 'CarUp guidance · rules-based (AI not connected)'}
                  </p>
                  <ul className="mt-3 space-y-2.5">
                    {guidance.lines.map(line => (
                      <li key={line} className="grid grid-cols-[0.75rem_1fr] gap-2 text-[14px] leading-6 text-white/85">
                        <span className="mt-2.5 h-1.5 w-1.5 rounded-full bg-[#FE7D18]" aria-hidden="true" />{line}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-[12px] leading-5 text-white/55">
                    Advice only. CarUp AI cannot verify a vehicle, approve a deal or create Trust evidence.
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
