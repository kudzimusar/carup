/**
 * RX-06 — the import request (POST /diaspora/import-orders), shared by the legacy form and the focused
 * flow so both validate and send EXACTLY the same thing:
 *  - `importRequestErrors` holds the legacy rules and messages unchanged;
 *  - `importRequestPayload` is the legacy payload (one model year: max = min; budget as a number);
 *  - the focused flow only splits the same fields into one-goal steps.
 * The session draft lives in this browser tab only (sessionStorage) and is never sent anywhere. LR02:
 * it names its owner ('guest' or the account id) and expires, and it is restored only to that owner
 * (a guest's draft also to the account that signs in from the same tab) before it expires.
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
  { key: 'review', title: 'Check and send', help: 'Sending records your request. To get quotes, publish it to sellers from Sourcing requests; you can add documents to the order straight away.', fields: [] },
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

/**
 * LR02 — a draft is restorable for 7 days after its last change. The Owner asked for longer than the first
 * 12 hours (2026-11-21). sessionStorage already ends with the tab, but a tab can stay open — or be restored
 * with its storage — for days; 7 days covers coming back to the same tab after a weekend or a busy week.
 * The draft holds only whitelisted, non-sensitive fields. It is restored only to its owner, or, for a guest
 * draft, to the account that signs in from this tab, which must still review it and press Send.
 */
export const IMPORT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** The same period in words, for the copy that tells people how long a draft is kept. */
export const IMPORT_DRAFT_TTL_LABEL = '7 days'
/** Clock adjustments tolerated when checking that an expiry is no further away than a fresh one. */
const DRAFT_CLOCK_SLACK_MS = 5 * 60 * 1000

/** LR02 — the owner recorded on a draft prepared while signed out. */
export const GUEST_DRAFT_OWNER = 'guest'

export interface ImportDraft {
  form: DiasporaImportOrderPayload
  step: number
  savedAt: string
  /** 'guest', or the id of the signed-in account that saved it; null when the stored draft names none. */
  owner: string | null
  /** When the draft stops being restorable; null when the stored draft carries no expiry. */
  expiresAt: string | null
}

const STRING_FIELDS: ImportRequestField[] = ['origin_country', 'origin_city', 'destination_city', 'requested_make', 'requested_model']

/** The whitelisted, non-sensitive answers a draft may hold (never `metadata` or anything else). */
type DraftFields = Pick<DiasporaImportOrderPayload, 'order_type' | 'origin_country' | 'origin_city' | 'destination_city' | 'requested_make' | 'requested_model' | 'requested_year_min' | 'budget_amount'>

function draftFields(form: DiasporaImportOrderPayload): DraftFields {
  return {
    order_type: form.order_type,
    origin_country: form.origin_country,
    origin_city: form.origin_city,
    destination_city: form.destination_city,
    requested_make: form.requested_make,
    requested_model: form.requested_model,
    requested_year_min: form.requested_year_min,
    budget_amount: form.budget_amount,
  }
}

/**
 * Parses and sanitises the stored draft (whitelisted fields only; `metadata` never comes back). It does
 * NOT decide whether the draft may be shown: the page restores only through `restoreImportDraft`.
 */
export function readImportDraft(storage: Pick<Storage, 'getItem'> | null | undefined = safeSession()): ImportDraft | null {
  try {
    const raw = storage?.getItem(IMPORT_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { form?: Record<string, unknown>; step?: unknown; savedAt?: unknown; owner?: unknown; expiresAt?: unknown }
    if (!parsed || typeof parsed !== 'object' || !parsed.form || typeof parsed.form !== 'object') return null
    const f = parsed.form
    const form: DiasporaImportOrderPayload = { ...INITIAL_IMPORT_REQUEST }
    if (f.order_type === 'vehicle' || f.order_type === 'parts') form.order_type = f.order_type
    for (const field of STRING_FIELDS) if (typeof f[field] === 'string') (form as unknown as Record<string, unknown>)[field] = f[field]
    if (typeof f.requested_year_min === 'number' && Number.isFinite(f.requested_year_min)) form.requested_year_min = f.requested_year_min
    if (typeof f.budget_amount === 'number' && Number.isFinite(f.budget_amount)) form.budget_amount = f.budget_amount
    const step = typeof parsed.step === 'number' && parsed.step >= 0 && parsed.step < IMPORT_REQUEST_STEPS.length ? Math.floor(parsed.step) : 0
    return {
      form,
      step,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      owner: typeof parsed.owner === 'string' && parsed.owner.trim() !== '' ? parsed.owner : null,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
    }
  } catch {
    return null
  }
}

/**
 * Keeps the answers in this tab (whitelisted fields only) with an expiry IMPORT_DRAFT_TTL_MS (7 days) on. `owner` is
 * 'guest' or the signed-in account id; a draft written without an owner is never restored.
 */
export function writeImportDraft(
  form: DiasporaImportOrderPayload,
  step: number,
  storage: Pick<Storage, 'setItem'> | null | undefined = safeSession(),
  owner?: string,
  now: number = Date.now(),
): string | null {
  try {
    const savedAt = new Date(now).toISOString()
    const expiresAt = new Date(now + IMPORT_DRAFT_TTL_MS).toISOString()
    storage?.setItem(IMPORT_DRAFT_KEY, JSON.stringify({ form: draftFields(form), step, savedAt, expiresAt, ...(owner ? { owner } : {}) }))
    return storage ? savedAt : null
  } catch {
    return null
  }
}

/** LR02 — who a draft opened now belongs to: 'guest' when signed out, else the account id (null if unknown). */
export function importDraftOwner(signedIn: boolean, userId: string | null | undefined): string | null {
  if (!signedIn) return GUEST_DRAFT_OWNER
  return typeof userId === 'string' && userId.trim() !== '' && userId !== GUEST_DRAFT_OWNER ? userId : null
}

/** True while the expiry is ahead of `now` and no further away than a freshly saved draft's would be. */
export function isImportDraftLive(draft: Pick<ImportDraft, 'expiresAt'>, now: number = Date.now()): boolean {
  const expires = draft.expiresAt ? Date.parse(draft.expiresAt) : Number.NaN
  return Number.isFinite(expires) && expires > now && expires - now <= IMPORT_DRAFT_TTL_MS + DRAFT_CLOCK_SLACK_MS
}

export type ImportDraftRestore =
  /** Nothing to show: no draft, or one that was discarded (and why). */
  | { kind: 'none'; discarded: 'unreadable' | 'expired' | 'other-owner' | null }
  /** This identity's own draft: resume it where it was left. */
  | { kind: 'own'; draft: ImportDraft }
  /** A draft prepared while signed out, now opened by a signed-in account. */
  | { kind: 'from-guest'; draft: ImportDraft }

export const NO_IMPORT_DRAFT: ImportDraftRestore = { kind: 'none', discarded: null }

/**
 * LR02 — the only way the page brings a draft back. It accepts a draft only while it is unexpired and
 * its owner is 'guest' or `owner` (the identity opening the page); any other stored draft is discarded.
 */
export function restoreImportDraft(
  owner: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null | undefined = safeSession(),
  now: number = Date.now(),
): ImportDraftRestore {
  let raw: string | null | undefined
  try {
    raw = storage?.getItem(IMPORT_DRAFT_KEY)
  } catch {
    return NO_IMPORT_DRAFT
  }
  if (!raw) return NO_IMPORT_DRAFT
  const draft = readImportDraft(storage)
  const discarded = !draft ? 'unreadable'
    : !isImportDraftLive(draft, now) ? 'expired'
      : draft.owner !== GUEST_DRAFT_OWNER && draft.owner !== owner ? 'other-owner'
        : null
  if (!draft || discarded) {
    clearImportDraft(storage)
    return { kind: 'none', discarded }
  }
  return draft.owner === GUEST_DRAFT_OWNER && owner !== GUEST_DRAFT_OWNER ? { kind: 'from-guest', draft } : { kind: 'own', draft }
}

/** Where a draft restored after sign-in opens: the review when complete, else the first step needing an answer. */
export function restoredDraftStep(form: DiasporaImportOrderPayload): number {
  const target = firstStepWithError(importRequestErrors(form))
  return target >= 0 ? target : IMPORT_REQUEST_STEPS.length - 1
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
