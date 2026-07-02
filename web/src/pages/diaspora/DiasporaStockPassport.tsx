/**
 * DiasporaStockPassport — READ-ONLY "passport" view of a diaspora stock item
 * (route: /diaspora/stock/:id/passport).
 *
 * Load strategy: fetchDiasporaStockItem is the backbone (fatal on failure, with a back link).
 * The reservation ledger, supply documents (client-filtered to the item's supply_document_id) and
 * the seller trade profile are BEST-EFFORT enrichments — each failure collapses only its own
 * section to an explicit "unavailable" note; the page never blanks.
 *
 * The quantity/reservation ledger IS the provenance history: stock movements are the sealed audit
 * trail (the per-item audit read endpoint is server-side only). Photos are post-MVP (no photo
 * schema exists yet).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Loader2, PackageSearch, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { classifyActionError } from '@/components/diaspora/safetrade/safeTradeHelpers'
import type {
  DiasporaStockItem,
  DiasporaStockLedgerEntry,
  DiasporaSupplyDocument,
  DiasporaTradeProfile,
} from '@/types'

function labelize(value?: string | null): string {
  if (!value) return 'Not set'
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
}

/** Short-form id only — never render raw emails/phones. */
function shortId(value?: string | null): string {
  if (!value) return '—'
  return value.length > 8 ? `${value.slice(0, 8)}…` : value
}

function formatMoney(amount?: number | string | null, currency?: string | null): string {
  if (amount === undefined || amount === null || amount === '') return 'Not set'
  const numeric = Number(amount)
  if (Number.isNaN(numeric)) return 'Not set'
  return `${currency || 'USD'} ${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function formatDate(iso?: string | null): string {
  if (!iso) return 'Not recorded'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString()
}

function statusVariant(status?: string | null): 'default' | 'secondary' | 'destructive' {
  const s = (status || '').toUpperCase()
  if (/(VERIFIED|ACCEPTED|APPROVED|CONFIRMED|COMPLETED|PUBLISHED|READY|ACTIVE|RELEASED)/.test(s)) return 'default'
  if (/(REJECTED|FAILED|CANCELLED|EXPIRED|MISSING|FLAGGED|DISPUTED)/.test(s)) return 'destructive'
  return 'secondary'
}

// ── Small read-only presentation helpers ──
function PassportSection({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <h2 className="text-base font-semibold">{title}</h2>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  )
}

function Field({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid={testId}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function EmptyNote({ testId, children = 'None recorded' }: { testId: string; children?: ReactNode }) {
  return <p className="text-sm text-muted-foreground" data-testid={testId}>{children}</p>
}

function UnavailableNote({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid={testId}>
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}

export default function DiasporaStockPassport() {
  const { id = '' } = useParams<{ id: string }>()
  const { isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()

  const [item, setItem] = useState<DiasporaStockItem | null>(null)
  // Best-effort enrichments: `null` means the fetch FAILED (section shows an "unavailable" note).
  const [ledger, setLedger] = useState<DiasporaStockLedgerEntry[] | null>([])
  const [supplyDocs, setSupplyDocs] = useState<DiasporaSupplyDocument[] | null>([])
  const [profile, setProfile] = useState<DiasporaTradeProfile | null>(null)
  const [profileFailed, setProfileFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const loadingRef = useRef(false)
  const [fatal, setFatal] = useState<{ kind: 'notfound' | 'forbidden' | 'session' | 'error'; message: string } | null>(null)

  const canView = isAuthenticated

  const load = useCallback(async () => {
    if (!canView || !id || loadingRef.current) return
    loadingRef.current = true
    setLoading(true); setFatal(null)
    try {
      // Backbone — failure here is fatal for the whole passport.
      const stockItem = await api.fetchDiasporaStockItem(id)
      setItem(stockItem)
      // Best-effort enrichments — a single failure must not blank the page.
      try { setLedger(await api.fetchDiasporaStockLedger(id)) } catch { setLedger(null) }
      if (stockItem.supply_document_id) {
        // Client-side filter to the item's supply_document_id (the list endpoint does not filter by id).
        try { setSupplyDocs(await api.fetchDiasporaSupplyDocuments()) } catch { setSupplyDocs(null) }
      } else {
        setSupplyDocs([])
      }
      if (stockItem.seller_trade_profile_id) {
        try { setProfile(await api.fetchDiasporaTradeProfile(stockItem.seller_trade_profile_id)); setProfileFailed(false) } catch { setProfile(null); setProfileFailed(true) }
      } else {
        setProfile(null); setProfileFailed(false)
      }
    } catch (err) {
      const { kind } = classifyActionError(err)
      if (kind === 'session') setFatal({ kind: 'session', message: 'Your session has expired. Please sign in again to view this passport.' })
      else if (kind === 'notfound') setFatal({ kind: 'notfound', message: 'This stock item was not found.' })
      else if (kind === 'forbidden') setFatal({ kind: 'forbidden', message: 'You do not have access to this stock item.' })
      else setFatal({ kind: 'error', message: 'Could not load this stock passport. Please retry.' })
    } finally { setLoading(false); setHasLoaded(true); loadingRef.current = false }
  }, [api, canView, id])

  // Depend on stable primitives (not `load`/`api`): useCarUpApi() returns a fresh object each render,
  // so depending on the api object (or a callback derived from it) would loop the effect forever.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!authLoading && canView) void load() }, [authLoading, canView, id])

  if (authLoading || (loading && !hasLoaded)) {
    return <div className="flex min-h-[40vh] items-center justify-center text-orange-600" data-testid="stock-passport-loading"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /></div>
  }

  if (!isAuthenticated) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12" data-testid="stock-passport-auth-required">
        <Alert>
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Sign in required</AlertTitle>
          <AlertDescription>
            Please sign in to view this stock passport.
            <Button asChild size="sm" variant="default" className="ml-2"><Link to="/login">Sign in</Link></Button>
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  if (fatal) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12" data-testid={`stock-passport-${fatal.kind}`}>
        <Alert variant={fatal.kind === 'error' ? 'destructive' : 'default'}>
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Unable to open passport</AlertTitle>
          <AlertDescription>
            {fatal.message}
            <span className="ml-2 inline-flex gap-2">
              {fatal.kind === 'error' && <Button size="sm" variant="outline" onClick={() => void load()} data-testid="stock-passport-retry">Retry</Button>}
              {fatal.kind === 'session' && <Button asChild size="sm" variant="default"><Link to="/login" data-testid="stock-passport-signin">Sign in</Link></Button>}
              <Button asChild size="sm" variant="ghost"><Link to="/diaspora/stock" data-testid="stock-passport-back">Back to stock</Link></Button>
            </span>
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  if (!item) return null

  const onHand = item.balances?.onHand ?? item.quantity_on_hand ?? 0
  const reserved = item.balances?.reserved ?? item.quantity_reserved ?? 0
  const available = item.balances?.available ?? Math.max(onHand - reserved, 0)
  const supplyDoc = item.supply_document_id && supplyDocs
    ? supplyDocs.find((d) => d.id === item.supply_document_id) || null
    : null
  const sortedLedger = [...(ledger || [])]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())

  // Supply-document row, shared by the provenance and documents sections. Parameterized by a
  // testid suffix so the two renders never duplicate a data-testid in the DOM.
  const renderSupplyDoc = (suffix: string) => !item.supply_document_id
    ? <EmptyNote testId={`stock-passport-supply-doc-none-${suffix}`}>None</EmptyNote>
    : supplyDocs === null
      ? <UnavailableNote testId={`stock-passport-supply-doc-unavailable-${suffix}`}>The linked supply document is unavailable right now.</UnavailableNote>
      : supplyDoc
        ? (
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid={`stock-passport-supply-doc-${suffix}`}>
            <span className="font-medium">{supplyDoc.document_number} — {supplyDoc.title}</span>
            <Badge variant={statusVariant(supplyDoc.status)}>{labelize(supplyDoc.status)}</Badge>
          </div>
        )
        : (
          <p className="text-muted-foreground" data-testid={`stock-passport-supply-doc-missing-${suffix}`}>
            Linked document {shortId(item.supply_document_id)} is not visible to you.
          </p>
        )

  return (
    <main className="mx-auto max-w-4xl px-4 py-8" data-testid="stock-passport-page" aria-busy={loading}>
      <div className="mb-3 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to="/diaspora/stock" data-testid="stock-passport-back"><ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Stock</Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => void load()} aria-busy={loading} data-testid="stock-passport-refresh">
          {loading
            ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
            : <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />}
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold" data-testid="stock-passport-title">
          <PackageSearch className="h-6 w-6 text-orange-600" aria-hidden="true" /> Stock item passport
        </h1>
        <p className="text-sm text-muted-foreground">Read-only provenance record for stock item {shortId(item.id)}.</p>
      </header>

      <div className="space-y-4">
        {/* 1 — Item identity */}
        <PassportSection title="Item identity" testId="stock-passport-identity">
          <Field label="Part name" value={item.part_name} testId="stock-passport-part-name" />
          <Field label="Item id" value={shortId(item.id)} testId="stock-passport-id" />
          <Field label="Condition" value={labelize(item.condition)} testId="stock-passport-condition" />
          <Field
            label="Publication"
            value={<Badge variant={statusVariant(item.publication_status)} data-testid="stock-passport-publication-badge">{labelize(item.publication_status)}</Badge>}
          />
          <Field
            label="Verification"
            value={<Badge variant={statusVariant(item.verification_status)} data-testid="stock-passport-verification-badge">{labelize(item.verification_status)}</Badge>}
          />
          <Field
            label="Export readiness"
            value={<Badge variant={statusVariant(item.export_readiness_status)} data-testid="stock-passport-export-badge">{labelize(item.export_readiness_status)}</Badge>}
          />
        </PassportSection>

        {/* 2 — Seller / supplier */}
        <PassportSection title="Seller / supplier" testId="stock-passport-seller">
          {profile
            ? (
              <>
                <Field label="Display name" value={profile.display_name || 'Not set'} testId="stock-passport-seller-name" />
                <Field label="Profile type" value={labelize(profile.profile_type)} testId="stock-passport-seller-type" />
                <Field
                  label="Verification"
                  value={<Badge variant={statusVariant(profile.verification_status)}>{labelize(profile.verification_status)}</Badge>}
                  testId="stock-passport-seller-verification"
                />
                <Field label="Trust score" value={profile.trust_score ?? 'Not scored'} testId="stock-passport-seller-trust" />
              </>
            )
            : profileFailed || item.seller_trade_profile_id
              ? <p className="text-muted-foreground" data-testid="stock-passport-seller-unavailable">Profile unavailable</p>
              : <EmptyNote testId="stock-passport-seller-none">No seller profile linked</EmptyNote>}
        </PassportSection>

        {/* 3 — Provenance & source */}
        <PassportSection title="Provenance & source" testId="stock-passport-provenance">
          <Field
            label="Origin"
            value={[item.origin_city, item.origin_country].filter(Boolean).join(', ') || 'Not set'}
            testId="stock-passport-origin"
          />
          <Separator />
          <p className="font-medium">Linked supply document</p>
          {renderSupplyDoc('provenance')}
        </PassportSection>

        {/* 4 — Compatibility */}
        <PassportSection title="Compatibility" testId="stock-passport-compatibility">
          <Field label="Vehicle make" value={item.vehicle_make || 'Not set'} testId="stock-passport-make" />
          <Field label="Vehicle model" value={item.vehicle_model || 'Not set'} testId="stock-passport-model" />
          <Field
            label="Year range"
            value={item.vehicle_year_min || item.vehicle_year_max
              ? `${item.vehicle_year_min ?? '—'} – ${item.vehicle_year_max ?? '—'}`
              : 'Not set'}
            testId="stock-passport-years"
          />
          <Field label="Part number" value={item.part_number || 'Not set'} testId="stock-passport-part-number" />
          <Field label="OEM number" value={item.oem_number || 'Not set'} testId="stock-passport-oem-number" />
        </PassportSection>

        {/* 5 — Price */}
        <PassportSection title="Price" testId="stock-passport-price">
          <Field label="Unit price" value={formatMoney(item.unit_price, item.currency)} testId="stock-passport-price-value" />
        </PassportSection>

        {/* 6 — Quantity & reservation ledger (this IS the provenance/quantity history) */}
        <PassportSection title="Quantity & reservation ledger" testId="stock-passport-ledger">
          <div className="grid grid-cols-3 gap-2" data-testid="stock-passport-balances">
            <div className="rounded-md border px-3 py-2 text-center">
              <p className="text-xs text-muted-foreground">On hand</p>
              <p className="text-lg font-semibold" data-testid="stock-passport-balance-onhand">{onHand}</p>
            </div>
            <div className="rounded-md border px-3 py-2 text-center">
              <p className="text-xs text-muted-foreground">Reserved</p>
              <p className="text-lg font-semibold" data-testid="stock-passport-balance-reserved">{reserved}</p>
            </div>
            <div className="rounded-md border px-3 py-2 text-center">
              <p className="text-xs text-muted-foreground">Available</p>
              <p className="text-lg font-semibold" data-testid="stock-passport-balance-available">{available}</p>
            </div>
          </div>
          {ledger === null
            ? <UnavailableNote testId="stock-passport-ledger-unavailable">The movement ledger is unavailable right now.</UnavailableNote>
            : sortedLedger.length === 0
              ? <EmptyNote testId="stock-passport-ledger-empty" />
              : (
                <Table data-testid="stock-passport-ledger-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead>Balance after</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedLedger.map((entry) => (
                      <TableRow key={entry.id} data-testid={`stock-passport-ledger-row-${entry.id}`}>
                        <TableCell className="font-medium">{labelize(entry.action_type)}</TableCell>
                        <TableCell>{entry.quantity_delta ?? '—'}</TableCell>
                        <TableCell>{entry.quantity_after ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(entry.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
        </PassportSection>

        {/* 7 — Documents & verification (photos are post-MVP — no photo schema exists) */}
        <PassportSection title="Documents & verification" testId="stock-passport-documents">
          {renderSupplyDoc('documents')}
          <p className="text-xs text-muted-foreground" data-testid="stock-passport-photos-note">Photos: not yet supported</p>
        </PassportSection>

        {/* 8 — Matches / RFQs (cross-party data is never fetched here) */}
        <PassportSection title="Matches / RFQs" testId="stock-passport-matches">
          <p className="text-muted-foreground" data-testid="stock-passport-matches-note">
            Matching visibility is available to buyers on their demand orders.
          </p>
        </PassportSection>

        {/* 9 — Audit */}
        <PassportSection title="Audit" testId="stock-passport-audit">
          <p className="text-muted-foreground" data-testid="stock-passport-audit-note">
            Stock movements above are the sealed audit trail. The full per-item audit record is retained server-side.
          </p>
        </PassportSection>
      </div>
    </main>
  )
}
