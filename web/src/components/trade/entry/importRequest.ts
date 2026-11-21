/**
 * RX-06 — the import request (POST /diaspora/import-orders), shared by the legacy form and the focused
 * flow so both validate and send EXACTLY the same thing:
 *  - `importRequestErrors` holds the legacy rules and messages unchanged;
 *  - `importRequestPayload` is the legacy payload (one model year: max = min; budget as a number);
 *  - the focused flow only splits the same fields into one-goal steps.
 * The session draft lives in this browser tab only (sessionStorage) and is never sent anywhere.
 */
import type { DiasporaImportOrderPayload } from '@/types'
import { isValidVehicleYear } from '@/data/vehicleTaxonomy'

export const INITIAL_IMPORT_REQUEST: DiasporaImportOrderPayload = {
  order_type: 'vehicle',
  origin_country: '',
  origin_city: '',
  destination_country: 'Zimbabwe',
  destination_city: '',
  requested_make: '',
  requested_model: '',
  requested_year_min: new Date().getFullYear(),
  requested_year_max: new Date().getFullYear(),
  budget_amount: undefined,
  budget_currency: 'USD',
}

export type ImportRequestField = keyof DiasporaImportOrderPayload

/** The legacy validation, unchanged (field → message). */
export function importRequestErrors(form: DiasporaImportOrderPayload): Record<string, string> {
  const nextErrors: Record<string, string> = {}
  if (!form.order_type) nextErrors.order_type = 'Choose vehicle or parts.'
  if (!form.origin_country?.trim()) nextErrors.origin_country = 'Origin country is required.'
  if (!form.origin_city?.trim()) nextErrors.origin_city = 'Origin city is required.'
  if (!form.destination_city?.trim()) nextErrors.destination_city = 'Destination city is required.'
  if (!form.requested_make?.trim()) nextErrors.requested_make = 'Make is required.'
  if (!form.requested_model?.trim()) nextErrors.requested_model = 'Model is required.'
  if (!form.requested_year_min || !isValidVehicleYear(form.requested_year_min)) nextErrors.requested_year_min = 'Enter a valid vehicle year.'
  if (!form.budget_amount || Number(form.budget_amount) <= 0) nextErrors.budget_amount = 'Budget is required.'
  return nextErrors
}

/** The legacy request body: one model year (max = min) and the budget as a number. */
export function importRequestPayload(form: DiasporaImportOrderPayload): DiasporaImportOrderPayload {
  return {
    ...form,
    requested_year_max: form.requested_year_min,
    budget_amount: Number(form.budget_amount),
  }
}

export interface ImportRequestStep {
  key: 'cargo' | 'vehicle' | 'route' | 'budget' | 'review'
  title: string
  help: string
  fields: ImportRequestField[]
}

/** One goal per step, over the legacy fields. */
export const IMPORT_REQUEST_STEPS: readonly ImportRequestStep[] = [
  { key: 'cargo', title: 'What are you importing?', help: 'Choose whether this request is for a whole vehicle or for parts.', fields: ['order_type'] },
  { key: 'vehicle', title: 'Which vehicle?', help: 'Tell sellers what to quote on. Pick a make and model from CarUp’s catalogue or type your own — a name the catalogue does not know is recorded exactly as you typed it.', fields: ['requested_make', 'requested_model', 'requested_year_min'] },
  { key: 'route', title: 'From where, to where?', help: 'Where the vehicle is now, or where sellers should source it, and the Zimbabwe city it should reach.', fields: ['origin_country', 'origin_city', 'destination_city'] },
  { key: 'budget', title: 'Your budget', help: 'Recorded on the order as your stated budget. It is not a price, a quote or a payment, and nothing is charged.', fields: ['budget_amount'] },
  { key: 'review', title: 'Check and send', help: 'Sending records your request. Sellers can then quote, and you can add documents to the order straight away.', fields: [] },
]

/** The legacy errors that belong to one step. */
export function stepErrors(form: DiasporaImportOrderPayload, stepIndex: number): Record<string, string> {
  const step = IMPORT_REQUEST_STEPS[stepIndex]
  if (!step) return {}
  const all = importRequestErrors(form)
  return Object.fromEntries(Object.entries(all).filter(([field]) => (step.fields as string[]).includes(field)))
}

/** The first step holding any of these field errors (or -1). */
export function firstStepWithError(errors: Record<string, string>): number {
  return IMPORT_REQUEST_STEPS.findIndex(step => step.fields.some(field => Boolean(errors[field])))
}

/* ── Session draft (this browser tab only; never sent) ──────────────────────────────────────────── */

export const IMPORT_DRAFT_KEY = 'carup-trade-import-draft'

export interface ImportDraft {
  form: DiasporaImportOrderPayload
  step: number
  savedAt: string
}

const STRING_FIELDS: ImportRequestField[] = ['origin_country', 'origin_city', 'destination_city', 'requested_make', 'requested_model']

export function readImportDraft(storage: Pick<Storage, 'getItem'> | null | undefined = safeSession()): ImportDraft | null {
  try {
    const raw = storage?.getItem(IMPORT_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { form?: Record<string, unknown>; step?: unknown; savedAt?: unknown }
    if (!parsed || typeof parsed !== 'object' || !parsed.form || typeof parsed.form !== 'object') return null
    const f = parsed.form
    const form: DiasporaImportOrderPayload = { ...INITIAL_IMPORT_REQUEST }
    if (f.order_type === 'vehicle' || f.order_type === 'parts') form.order_type = f.order_type
    for (const field of STRING_FIELDS) if (typeof f[field] === 'string') (form as unknown as Record<string, unknown>)[field] = f[field]
    if (typeof f.requested_year_min === 'number' && Number.isFinite(f.requested_year_min)) form.requested_year_min = f.requested_year_min
    if (typeof f.budget_amount === 'number' && Number.isFinite(f.budget_amount)) form.budget_amount = f.budget_amount
    const step = typeof parsed.step === 'number' && parsed.step >= 0 && parsed.step < IMPORT_REQUEST_STEPS.length ? Math.floor(parsed.step) : 0
    return { form, step, savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString() }
  } catch {
    return null
  }
}

export function writeImportDraft(form: DiasporaImportOrderPayload, step: number, storage: Pick<Storage, 'setItem'> | null | undefined = safeSession()): string | null {
  try {
    const savedAt = new Date().toISOString()
    storage?.setItem(IMPORT_DRAFT_KEY, JSON.stringify({ form, step, savedAt }))
    return storage ? savedAt : null
  } catch {
    return null
  }
}

export function clearImportDraft(storage: Pick<Storage, 'removeItem'> | null | undefined = safeSession()): void {
  try {
    storage?.removeItem(IMPORT_DRAFT_KEY)
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

/** True when the form differs from a fresh request (worth keeping as a draft). */
export function hasImportDraftContent(form: DiasporaImportOrderPayload): boolean {
  return STRING_FIELDS.some(field => String(form[field] ?? '').trim() !== '')
    || (form.budget_amount !== undefined && form.budget_amount !== null)
    || form.order_type !== INITIAL_IMPORT_REQUEST.order_type
}

function safeSession(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}
