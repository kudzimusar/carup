/**
 * RX-06 — the import request as a focused flow (rendered inside the coordinator's FocusedShell, which
 * owns the page title). One goal per step, plain-language help, a progress line, and a review step
 * that sends the SAME request body as the legacy form through the SAME handler. Exit keeps a draft in
 * this browser tab only (it is never sent until "Send import request"). No price, date or ETA appears.
 */
import { useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Boxes, Car, Check, Loader2, Pencil, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WorkspaceNotice } from '@/components/dealer/workspace/EmptyState'
import { WS_FIELD, WS_HINT, WS_LABEL, WS_PRIMARY, WS_SECONDARY, WS_TEXT_ACTION } from '@/components/dealer/workspace/workspaceStyles'
import { VEHICLE_MAKES, modelsForMake } from '@/data/vehicleTaxonomy'
import type { DiasporaImportOrderPayload, DiasporaOrderType } from '@/types'
import { money, place } from '@/components/trade/order/orderModel'
import { IMPORT_REQUEST_STEPS, firstStepWithError, importRequestErrors, stepErrors } from './importRequest'

export interface NewImportRequestFlowProps {
  form: DiasporaImportOrderPayload
  /** Errors from the page's own validation/submit (legacy messages; `form` = the server refusal). */
  errors: Record<string, string>
  submitting: boolean
  onChange: (field: keyof DiasporaImportOrderPayload, value: string | number | undefined) => void
  onSelectOrderType: (orderType: DiasporaOrderType) => void
  /** The legacy submit handler (validates everything, sends the request, opens the new order). */
  onSubmit: (event: FormEvent) => void
  initialStep?: number
  onStepChange?: (step: number) => void
  /** True while the answers are being kept in this browser tab (never sent before "Send"). */
  draftKept?: boolean
  onDiscardDraft?: () => void
  exitTo?: string
}

export function NewImportRequestFlow({
  form, errors, submitting, onChange, onSelectOrderType, onSubmit, initialStep = 0, onStepChange, draftKept = false, onDiscardDraft, exitTo = '/diaspora/imports',
}: NewImportRequestFlowProps) {
  const [step, setStepState] = useState(initialStep)
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const ids = useId()
  const total = IMPORT_REQUEST_STEPS.length
  const current = IMPORT_REQUEST_STEPS[step] ?? IMPORT_REQUEST_STEPS[0]

  const focusHeading = () => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => headingRef.current?.focus())
  }
  const setStep = (next: number) => {
    setStepState(next)
    setLocalErrors({})
    onStepChange?.(next)
    focusHeading()
  }

  const next = () => {
    const errs = stepErrors(form, step)
    if (Object.keys(errs).length > 0) { setLocalErrors(errs); return }
    setStep(Math.min(step + 1, total - 1))
  }

  // Enter on an earlier step continues; on the review step the legacy handler validates and sends.
  // A refused send takes the person to the first step that needs attention (same legacy rules).
  const handleSubmit = (event: FormEvent) => {
    if (current.key !== 'review') {
      event.preventDefault()
      next()
      return
    }
    const target = firstStepWithError(importRequestErrors(form))
    if (target >= 0) {
      setStepState(target)
      setLocalErrors(stepErrors(form, target))
      onStepChange?.(target)
      focusHeading()
    }
    onSubmit(event)
  }

  const shown = { ...Object.fromEntries(Object.entries(errors).filter(([k]) => k !== 'form')), ...localErrors }
  const fieldError = (field: string) => shown[field]


  const field = (name: keyof DiasporaImportOrderPayload) => cn(WS_FIELD, fieldError(name as string) && 'border-status-danger')
  const errorText = (name: string) => fieldError(name) ? <p id={`${ids}-${name}-error`} className="mt-1.5 text-xs font-semibold text-status-danger">{fieldError(name)}</p> : null
  const describedBy = (name: string) => fieldError(name) ? `${ids}-${name}-error` : undefined

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-6" data-testid="diaspora-import-form" data-step={current.key}>
      <div>
        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-carup-text-2">
          <span data-testid="trade-request-step-label">Step {step + 1} of {total}</span>
          {draftKept && <span className="text-carup-text-3" data-testid="trade-request-draft-saved">Kept on this device</span>}
        </div>
        <div role="progressbar" aria-label="Import request progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step + 1} className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
          {IMPORT_REQUEST_STEPS.map((s, i) => (
            <span key={s.key} className={cn('h-1.5 rounded-full', i < step ? 'bg-carup-text' : i === step ? '' : 'bg-carup-bg-surface-2')} style={i === step ? { background: 'var(--carup-raw-orange-signal)' } : undefined} />
          ))}
        </div>
      </div>

      <section aria-labelledby={`${ids}-title`} className="space-y-4">
        <div>
          <h2 id={`${ids}-title`} ref={headingRef} tabIndex={-1} className="text-xl font-bold tracking-[-0.02em] text-carup-text outline-none" data-testid="trade-request-step-title">{current.title}</h2>
          <p className="mt-1 text-sm leading-6 text-carup-text-2">{current.help}</p>
        </div>

        {Object.keys(localErrors).length > 0 && (
          <WorkspaceNotice tone="danger" testId="diaspora-import-validation-error">Check the highlighted answer{Object.keys(localErrors).length === 1 ? '' : 's'} before continuing.</WorkspaceNotice>
        )}

        {current.key === 'cargo' && (
          <fieldset>
            <legend className="sr-only">Cargo type</legend>
            <div className="grid gap-3" data-testid="diaspora-order-type-control">
              {([
                { value: 'vehicle' as const, label: 'A vehicle', body: 'A car, pickup or other vehicle, imported whole.', icon: Car },
                { value: 'parts' as const, label: 'Parts', body: 'Parts or components rather than a whole vehicle.', icon: Boxes },
              ]).map(option => {
                const selected = form.order_type === option.value
                return (
                  <button key={option.value} type="button" aria-pressed={selected} onClick={() => onSelectOrderType(option.value)}
                    className={cn('flex min-h-16 items-start gap-3 rounded-card border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus',
                      selected ? 'border-carup-text bg-carup-bg-raised ring-1 ring-carup-text' : 'border-carup-line bg-carup-bg-raised hover:border-carup-line-strong')}
                    data-testid={`diaspora-order-type-${option.value}`}>
                    <option.icon className="mt-0.5 h-5 w-5 shrink-0 text-carup-text-2" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-carup-text">{option.label}</span>
                      <span className="block text-sm text-carup-text-2">{option.body}</span>
                    </span>
                    <span aria-hidden="true" className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', selected ? 'border-carup-text bg-carup-text text-carup-bg-raised' : 'border-carup-line-strong')}>
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                  </button>
                )
              })}
            </div>
            {errorText('order_type')}
          </fieldset>
        )}

        {current.key === 'vehicle' && (
          <div className="space-y-4">
            <div>
              <label className={WS_LABEL} htmlFor={`${ids}-make`}>Make</label>
              <input id={`${ids}-make`} list={`${ids}-makes`} value={form.requested_make ?? ''} onChange={e => onChange('requested_make', e.target.value)} className={field('requested_make')} aria-invalid={Boolean(fieldError('requested_make'))} aria-describedby={describedBy('requested_make')} autoComplete="off" data-testid="diaspora-make-input" />
              <datalist id={`${ids}-makes`}>{VEHICLE_MAKES.map(make => <option key={make} value={make} />)}</datalist>
              {errorText('requested_make')}
            </div>
            <div>
              <label className={WS_LABEL} htmlFor={`${ids}-model`}>Model</label>
              <input id={`${ids}-model`} list={`${ids}-models`} value={form.requested_model ?? ''} onChange={e => onChange('requested_model', e.target.value)} className={field('requested_model')} aria-invalid={Boolean(fieldError('requested_model'))} aria-describedby={describedBy('requested_model')} autoComplete="off" data-testid="diaspora-model-input" />
              <datalist id={`${ids}-models`}>{modelsForMake(form.requested_make).map(model => <option key={model.id} value={model.name} />)}</datalist>
              {errorText('requested_model')}
            </div>
            <div>
              <label className={WS_LABEL} htmlFor={`${ids}-year`}>Model year</label>
              <input id={`${ids}-year`} type="number" inputMode="numeric" value={form.requested_year_min || ''} onChange={e => onChange('requested_year_min', Number(e.target.value) || undefined)} className={cn(field('requested_year_min'), 'max-w-[10rem]')} aria-invalid={Boolean(fieldError('requested_year_min'))} aria-describedby={describedBy('requested_year_min') ?? `${ids}-year-hint`} data-testid="diaspora-year-input" />
              <p id={`${ids}-year-hint`} className={WS_HINT}>One model year. Sellers quote for that year.</p>
              {errorText('requested_year_min')}
            </div>
          </div>
        )}

        {current.key === 'route' && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={WS_LABEL} htmlFor={`${ids}-origin-country`}>Origin country</label>
                <input id={`${ids}-origin-country`} value={form.origin_country} onChange={e => onChange('origin_country', e.target.value)} className={field('origin_country')} aria-invalid={Boolean(fieldError('origin_country'))} aria-describedby={describedBy('origin_country')} autoComplete="country-name" data-testid="diaspora-origin-country-input" />
                {errorText('origin_country')}
              </div>
              <div>
                <label className={WS_LABEL} htmlFor={`${ids}-origin-city`}>Origin city</label>
                <input id={`${ids}-origin-city`} value={form.origin_city ?? ''} onChange={e => onChange('origin_city', e.target.value)} className={field('origin_city')} aria-invalid={Boolean(fieldError('origin_city'))} aria-describedby={describedBy('origin_city')} data-testid="diaspora-origin-city-input" />
                {errorText('origin_city')}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={WS_LABEL} htmlFor={`${ids}-destination-city`}>Destination city in Zimbabwe</label>
                <input id={`${ids}-destination-city`} value={form.destination_city ?? ''} onChange={e => onChange('destination_city', e.target.value)} className={field('destination_city')} aria-invalid={Boolean(fieldError('destination_city'))} aria-describedby={describedBy('destination_city')} data-testid="diaspora-destination-city-input" />
                {errorText('destination_city')}
              </div>
              <div>
                <label className={WS_LABEL} htmlFor={`${ids}-destination-country`}>Destination country</label>
                <input id={`${ids}-destination-country`} value="Zimbabwe" readOnly className={cn(WS_FIELD, 'bg-carup-bg-surface text-carup-text-2')} aria-describedby={`${ids}-destination-hint`} data-testid="diaspora-destination-country-input" />
                <p id={`${ids}-destination-hint`} className={WS_HINT}>CarUp Trade imports to Zimbabwe.</p>
              </div>
            </div>
          </div>
        )}

        {current.key === 'budget' && (
          <div>
            <label className={WS_LABEL} htmlFor={`${ids}-budget`}>Budget (US dollars)</label>
            <div className="flex max-w-xs items-center gap-2">
              <span className="text-sm font-semibold text-carup-text-2" aria-hidden="true">USD</span>
              <input id={`${ids}-budget`} type="number" min="1" inputMode="decimal" value={form.budget_amount || ''} onChange={e => onChange('budget_amount', Number(e.target.value) || undefined)} className={field('budget_amount')} aria-invalid={Boolean(fieldError('budget_amount'))} aria-describedby={describedBy('budget_amount')} data-testid="diaspora-budget-input" />
            </div>
            {errorText('budget_amount')}
          </div>
        )}

        {current.key === 'review' && (
          <div className="space-y-4">
            {errors.form && (
              <WorkspaceNotice tone="danger" testId="diaspora-import-form-error"><strong className="font-semibold">Order not created.</strong> {errors.form}</WorkspaceNotice>
            )}
            <dl className="divide-y divide-carup-line rounded-card border border-carup-line bg-carup-bg-raised" data-testid="trade-request-review">
              {([
                ['cargo', 'Importing', form.order_type === 'parts' ? 'Parts' : 'A vehicle'],
                ['vehicle', 'Vehicle', [form.requested_make, form.requested_model, form.requested_year_min].filter(Boolean).join(' ') || 'Not given'],
                ['route', 'Route', `${place(form.origin_city, form.origin_country) ?? 'Origin not given'} → ${place(form.destination_city, form.destination_country) ?? 'Zimbabwe'}`],
                ['budget', 'Budget', money(form.budget_amount, form.budget_currency) ?? 'Not given'],
              ] as const).map(([key, label, value]) => (
                <div key={key} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <dt className="text-xs font-medium text-carup-text-3">{label}</dt>
                    <dd className="text-sm font-semibold text-carup-text [overflow-wrap:anywhere]">{value}</dd>
                  </div>
                  <button type="button" className={cn(WS_TEXT_ACTION, 'shrink-0')} onClick={() => setStep(IMPORT_REQUEST_STEPS.findIndex(s => s.key === key))} aria-label={`Change ${label.toLowerCase()}`}>
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Change
                  </button>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-5 text-carup-text-3">After you send it, the order reads “Request received”. No price, booking or arrival date is set by sending a request.</p>
          </div>
        )}
      </section>

      <div className="flex flex-col-reverse gap-3 border-t border-carup-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {step > 0 ? (
            <button type="button" className={WS_SECONDARY} onClick={() => setStep(step - 1)} data-testid="trade-request-back"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</button>
          ) : (
            <Link to={exitTo} className={WS_SECONDARY} data-testid="diaspora-cancel-import-button">Cancel</Link>
          )}
          {step > 0 && <Link to={exitTo} className={WS_TEXT_ACTION} data-testid="trade-request-exit">{draftKept ? 'Save and exit' : 'Exit'}</Link>}
        </div>
        {/* Distinct keys: React must never turn the clicked "Continue" element into the submit button —
            a browser runs the click's default action AFTER React re-renders, so a reused element would
            submit the request the moment the review step appears. */}
        {current.key === 'review' ? (
          <button key="send" type="submit" className={cn(WS_PRIMARY, 'w-full sm:w-auto')} disabled={submitting} data-testid="diaspora-submit-import-button">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            Send import request
          </button>
        ) : (
          <button key="continue" type="button" className={cn(WS_PRIMARY, 'w-full sm:w-auto')} onClick={next} data-testid="trade-request-continue">Continue <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
        )}
      </div>
      {draftKept && onDiscardDraft && (
        <p className="text-xs text-carup-text-3">
          Your answers are kept in this browser tab until you send or discard them; nothing reaches CarUp before you send.{' '}
          <button type="button" className="font-semibold text-carup-action underline-offset-4 hover:underline" onClick={onDiscardDraft} data-testid="trade-request-discard">Discard answers</button>
        </p>
      )}
    </form>
  )
}
