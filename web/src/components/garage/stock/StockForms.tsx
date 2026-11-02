import { useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { newIdempotencyKey, type CreatePartInput, type GaragePart } from '@/lib/garageBusiness'
import { normaliseCurrency, parseDecimalString, parseWholeNumber } from './stockPresentation'

/**
 * The garage ADMIN's stock forms. Four rules hold across all of them:
 *  1. a quantity is STATED — a form never pre-fills 0 and never submits a blank as 0;
 *  2. an amount never travels without its currency, and no currency is ever defaulted;
 *  3. a money/stock form generates ONE idempotency key when it opens (not per click), so a retry or a
 *     double-click cannot record the same movement or part twice;
 *  4. when the server refuses (403 for a non-admin, 409 for a rule), its own message is shown as-is.
 */

type Submit<T> = (body: T) => Promise<unknown>

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

function FormShell({
  title, onSubmit, onCancel, submitLabel, busy, error, testId, children,
}: {
  title: string
  onSubmit: (e: FormEvent) => void
  onCancel: () => void
  submitLabel: string
  busy: boolean
  error: string | null
  testId: string
  children: ReactNode
}) {
  return (
    <form onSubmit={onSubmit} noValidate aria-label={title} data-testid={testId} className="mt-4 rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <h3 className="font-semibold">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

// ───────────────────────────── create ─────────────────────────────

export function CreatePartForm({ onSubmit, onCancel }: { onSubmit: Submit<CreatePartInput>; onCancel: () => void }) {
  // ONE key per time this form is opened. A retry after a failure re-sends the same key.
  const [idempotencyKey] = useState(() => newIdempotencyKey())
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [opening, setOpening] = useState('')
  const [reorder, setReorder] = useState('')
  const [supplier, setSupplier] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [currency, setCurrency] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const cleanName = name.trim()
    const cleanSku = sku.trim()
    if (!cleanName) return setError('A part needs a name.')
    if (!cleanSku) return setError('A part needs a SKU.')
    if (opening.trim() === '') return setError('Enter the opening quantity. Enter 0 if there are none on the shelf. It is never assumed.')
    const openingQuantity = parseWholeNumber(opening)
    if (openingQuantity === null) return setError('The opening quantity must be a whole number, 0 or more.')

    let minStock: number | null = null
    if (reorder.trim() !== '') {
      minStock = parseWholeNumber(reorder)
      if (minStock === null) return setError('The reorder level must be a whole number, 0 or more, or left blank.')
    }

    const cost = unitCost.trim() === '' ? null : parseDecimalString(unitCost)
    const price = sellPrice.trim() === '' ? null : parseDecimalString(sellPrice)
    if (unitCost.trim() !== '' && cost === null) return setError('Enter the unit cost as an amount such as 12.50.')
    if (sellPrice.trim() !== '' && price === null) return setError('Enter the sell price as an amount such as 12.50.')
    const hasPrice = cost !== null || price !== null
    const code = currency.trim() === '' ? null : normaliseCurrency(currency)
    if (hasPrice && currency.trim() === '') return setError('Choose the currency of the price before saving. No currency is assumed.')
    if (currency.trim() !== '' && code === null) return setError('The currency must be a 3-letter code such as USD or ZAR.')

    const input: CreatePartInput = {
      name: cleanName,
      sku: cleanSku,
      opening_quantity: openingQuantity,
      idempotency_key: idempotencyKey,
    }
    if (minStock !== null) input.min_stock = minStock
    if (supplier.trim()) input.supplier = supplier.trim()
    if (cost !== null) input.unit_cost = cost
    if (price !== null) input.sell_price = price
    if (hasPrice && code) input.price_currency = code

    setBusy(true); setError(null)
    try {
      await onSubmit(input)
    } catch (err) {
      setError(messageOf(err, 'The part could not be added.'))
      setBusy(false)
    }
  }

  return (
    <FormShell title="Add a part" onSubmit={(e) => void submit(e)} onCancel={onCancel} submitLabel="Add part" busy={busy} error={error} testId="create-part-form">
      <Field id="create-part-name" label="Part name">
        <Input id="create-part-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="create-part-sku" label="SKU">
        <Input id="create-part-sku" value={sku} maxLength={80} onChange={(e) => setSku(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="create-part-opening" label="Opening quantity" hint="Count what is on the shelf now. Enter 0 if there is none. This is not filled in for you.">
        <Input id="create-part-opening" inputMode="numeric" value={opening} placeholder="Required" aria-describedby="create-part-opening-hint" onChange={(e) => setOpening(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="create-part-reorder" label="Reorder level (optional)" hint="Leave blank if you do not set one. A part with no reorder level is never reported as low.">
        <Input id="create-part-reorder" inputMode="numeric" value={reorder} aria-describedby="create-part-reorder-hint" onChange={(e) => setReorder(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="create-part-supplier" label="Supplier (optional)" hint="As you would say it. CarUp does not verify suppliers.">
        <Input id="create-part-supplier" value={supplier} maxLength={200} aria-describedby="create-part-supplier-hint" onChange={(e) => setSupplier(e.target.value)} autoComplete="off" />
      </Field>
      <div className="hidden sm:block" aria-hidden="true" />
      <Field id="create-part-unit-cost" label="Unit cost (optional)">
        <Input id="create-part-unit-cost" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="create-part-sell-price" label="Sell price (optional)">
        <Input id="create-part-sell-price" inputMode="decimal" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="create-part-currency" label="Currency of the prices" hint="Required as soon as a cost or price is entered. Use a 3-letter code such as USD.">
        <Input id="create-part-currency" value={currency} maxLength={3} placeholder="e.g. USD" aria-describedby="create-part-currency-hint" onChange={(e) => setCurrency(e.target.value)} autoComplete="off" />
      </Field>
    </FormShell>
  )
}

// ───────────────────────────── receive ─────────────────────────────

export function ReceiveStockForm({ part, onSubmit, onCancel }: {
  part: GaragePart
  onSubmit: Submit<{ quantity: number; reason?: string; note?: string; idempotency_key: string }>
  onCancel: () => void
}) {
  const [idempotencyKey] = useState(() => newIdempotencyKey())
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const n = parseWholeNumber(quantity)
    if (n === null || n < 1) return setError('Enter the number of units received, a whole number greater than zero.')
    const body: { quantity: number; reason?: string; note?: string; idempotency_key: string } = { quantity: n, idempotency_key: idempotencyKey }
    if (reason.trim()) body.reason = reason.trim()
    if (note.trim()) body.note = note.trim()
    setBusy(true); setError(null)
    try {
      await onSubmit(body)
    } catch (err) {
      setError(messageOf(err, 'The stock could not be recorded.'))
      setBusy(false)
    }
  }

  return (
    <FormShell title={`Receive stock: ${part.name}`} onSubmit={(e) => void submit(e)} onCancel={onCancel} submitLabel="Record received stock" busy={busy} error={error} testId="receive-stock-form">
      <Field id="receive-quantity" label="Quantity received" hint="Units added to the shelf. This adds to the current quantity.">
        <Input id="receive-quantity" inputMode="numeric" value={quantity} placeholder="Required" aria-describedby="receive-quantity-hint" onChange={(e) => setQuantity(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="receive-reason" label="Reason (optional)">
        <Input id="receive-reason" value={reason} maxLength={60} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
      </Field>
      <div className="sm:col-span-2">
        <Field id="receive-note" label="Note (optional)">
          <Input id="receive-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        </Field>
      </div>
    </FormShell>
  )
}

// ───────────────────────────── count ─────────────────────────────

export function CountStockForm({ part, onSubmit, onCancel }: {
  part: GaragePart
  onSubmit: Submit<{ counted_quantity: number; reason?: string; note?: string; idempotency_key: string }>
  onCancel: () => void
}) {
  const [idempotencyKey] = useState(() => newIdempotencyKey())
  const [counted, setCounted] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (counted.trim() === '') return setError('Enter the quantity you counted on the shelf. Enter 0 if there is none.')
    const n = parseWholeNumber(counted)
    if (n === null) return setError('The counted quantity must be a whole number, 0 or more.')
    // Whether a reason is required is the server's rule (the first count of a part needs none); its message is shown if it refuses.
    const body: { counted_quantity: number; reason?: string; note?: string; idempotency_key: string } = { counted_quantity: n, idempotency_key: idempotencyKey }
    if (reason.trim()) body.reason = reason.trim()
    if (note.trim()) body.note = note.trim()
    setBusy(true); setError(null)
    try {
      await onSubmit(body)
    } catch (err) {
      setError(messageOf(err, 'The count could not be recorded.'))
      setBusy(false)
    }
  }

  return (
    <FormShell title={`Count stock: ${part.name}`} onSubmit={(e) => void submit(e)} onCancel={onCancel} submitLabel="Record count" busy={busy} error={error} testId="count-stock-form">
      <Field id="count-quantity" label="Counted quantity" hint="What you actually counted on the shelf. This replaces the quantity on record.">
        <Input id="count-quantity" inputMode="numeric" value={counted} placeholder="Required" aria-describedby="count-quantity-hint" onChange={(e) => setCounted(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="count-reason" label="Reason for the count" hint="Needed unless this is the first count of this part.">
        <Input id="count-reason" value={reason} maxLength={60} aria-describedby="count-reason-hint" onChange={(e) => setReason(e.target.value)} autoComplete="off" />
      </Field>
      <div className="sm:col-span-2">
        <Field id="count-note" label="Note (optional)">
          <Input id="count-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        </Field>
      </div>
    </FormShell>
  )
}

// ───────────────────────────── edit ─────────────────────────────

export function EditPartForm({ part, onSubmit, onCancel }: {
  part: GaragePart
  onSubmit: Submit<Record<string, unknown>>
  onCancel: () => void
}) {
  const original = {
    name: part.name,
    supplier: (part.supplier ?? '').trim(),
    reorder: part.min_stock === null || part.min_stock === undefined ? '' : String(part.min_stock),
    // the API states money as fixed-scale decimal strings; null is "not recorded" and stays a blank field
    unitCost: part.unit_cost ?? '',
    sellPrice: part.sell_price ?? '',
    currency: part.price_currency ?? '',
  }
  // A recorded price keeps its currency: relabelling 10 USD as 10 ZAR would silently change what the amount means.
  const currencyLocked = original.unitCost !== '' || original.sellPrice !== ''

  const [name, setName] = useState(original.name)
  const [supplier, setSupplier] = useState(original.supplier)
  const [reorder, setReorder] = useState(original.reorder)
  const [unitCost, setUnitCost] = useState(original.unitCost)
  const [sellPrice, setSellPrice] = useState(original.sellPrice)
  const [currency, setCurrency] = useState(original.currency)
  const [active, setActive] = useState(part.is_active)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const patch: Record<string, unknown> = {}

    const cleanName = name.trim()
    if (!cleanName) return setError('A part needs a name.')
    if (cleanName !== original.name) patch.name = cleanName

    if (supplier.trim() !== original.supplier) patch.supplier = supplier.trim() || null

    if (reorder.trim() !== original.reorder) {
      if (reorder.trim() === '') patch.min_stock = null
      else {
        const n = parseWholeNumber(reorder)
        if (n === null) return setError('The reorder level must be a whole number, 0 or more, or left blank.')
        patch.min_stock = n
      }
    }

    let pricesChanged = false
    const priceFields: Array<['unit_cost' | 'sell_price', string, string, string]> = [
      ['unit_cost', unitCost, original.unitCost, 'unit cost'],
      ['sell_price', sellPrice, original.sellPrice, 'sell price'],
    ]
    for (const [key, value, before, label] of priceFields) {
      if (value.trim() === before.trim()) continue
      pricesChanged = true
      if (value.trim() === '') { patch[key] = null; continue }
      const amount = parseDecimalString(value)
      if (amount === null) return setError(`Enter the ${label} as an amount such as 12.50, or leave it blank.`)
      patch[key] = amount
    }

    const finalHasPrice = unitCost.trim() !== '' || sellPrice.trim() !== ''
    const code = currency.trim() === '' ? null : normaliseCurrency(currency)
    if (finalHasPrice && currency.trim() === '') return setError('Choose the currency of the price before saving. No currency is assumed.')
    if (currency.trim() !== '' && code === null) return setError('The currency must be a 3-letter code such as USD or ZAR.')
    const currencyChanged = currency.trim().toUpperCase() !== original.currency
    if (finalHasPrice && code && (pricesChanged || currencyChanged)) patch.price_currency = code
    else if (!finalHasPrice && currencyChanged) patch.price_currency = code

    if (active !== part.is_active) patch.is_active = active

    if (Object.keys(patch).length === 0) return setError('Nothing has changed.')

    setBusy(true); setError(null)
    try {
      await onSubmit(patch)
    } catch (err) {
      setError(messageOf(err, 'The part could not be saved.'))
      setBusy(false)
    }
  }

  return (
    <FormShell title={`Edit part: ${part.name}`} onSubmit={(e) => void submit(e)} onCancel={onCancel} submitLabel="Save changes" busy={busy} error={error} testId="edit-part-form">
      <p className="sm:col-span-2 text-sm text-gray-600">
        The quantity is not edited here. It changes only when you receive stock, count the shelf, or use the part on a job.
      </p>
      <Field id="edit-part-name" label="Part name">
        <Input id="edit-part-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="edit-part-supplier" label="Supplier" hint="As you would say it. Leave blank for not stated.">
        <Input id="edit-part-supplier" value={supplier} maxLength={200} aria-describedby="edit-part-supplier-hint" onChange={(e) => setSupplier(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="edit-part-reorder" label="Reorder level" hint="Leave blank for no reorder level.">
        <Input id="edit-part-reorder" inputMode="numeric" value={reorder} aria-describedby="edit-part-reorder-hint" onChange={(e) => setReorder(e.target.value)} autoComplete="off" />
      </Field>
      <div className="hidden sm:block" aria-hidden="true" />
      <Field id="edit-part-unit-cost" label="Unit cost">
        <Input id="edit-part-unit-cost" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="edit-part-sell-price" label="Sell price">
        <Input id="edit-part-sell-price" inputMode="decimal" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} autoComplete="off" />
      </Field>
      <Field
        id="edit-part-currency" label="Currency of the prices"
        hint={currencyLocked ? 'Fixed while a price is recorded. Clear both prices and save to change it.' : 'Required as soon as a price is entered. Use a 3-letter code such as USD.'}
      >
        <Input id="edit-part-currency" value={currency} maxLength={3} readOnly={currencyLocked} aria-describedby="edit-part-currency-hint" onChange={(e) => setCurrency(e.target.value)} autoComplete="off" />
      </Field>
      <div className="flex items-center gap-3 min-h-11">
        <input id="edit-part-active" type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <label htmlFor="edit-part-active" className="text-sm font-medium">This part is active</label>
      </div>
    </FormShell>
  )
}
