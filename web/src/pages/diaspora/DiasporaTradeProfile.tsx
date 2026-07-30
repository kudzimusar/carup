import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AlertCircle, BadgeCheck, Loader2, ShieldCheck, UserCog, Ban } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { buildLoginRedirect } from '@/lib/returnTo'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { DiasporaTradeProfile } from '@/types'

// Reviewer/admin roles that may verify or suspend any profile. Backend is the real authority
// boundary (service-layer checks); this only gates whether the review console is shown.
const reviewerRoles = new Set(['admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer'])

const ROLE_TYPE_OPTIONS = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'seller', label: 'Seller' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'exporter', label: 'Exporter' },
  { value: 'agent', label: 'Agent' },
  { value: 'dealer', label: 'Dealer' },
  { value: 'company', label: 'Company' },
  { value: 'coordinator', label: 'Coordinator' },
]

// The backend enum does not include 'supplier'; map it onto the closest supported role so the
// seller/supplier self-service flow works against the existing schema (sellers and suppliers share
// the diaspora_trade_profiles table via role_type).
const SUPPLIER_FALLBACK_ROLE = 'seller'

function statusVariant(status?: string | null): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch ((status || '').toUpperCase()) {
    case 'VERIFIED': return 'default'
    case 'SUSPENDED': return 'destructive'
    case 'REJECTED': return 'destructive'
    case 'FLAGGED': return 'outline'
    default: return 'secondary'
  }
}

function errText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback
}

// The API client attaches the HTTP status to the thrown error; fall back to the message for
// transports that only surface text. A 429 is never retried automatically — the user retries.
function isRateLimited(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  if (status === 429) return true
  return err instanceof Error && /\b429\b|too many requests|rate limit/i.test(err.message)
}

export default function DiasporaTradeProfile() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  // Destructure the individual request functions instead of holding the aggregate `api` object.
  // useCarUpApi() returns a NEW object on every render and also owns loading/error state, so every
  // request re-rendered this page, changed the `api` identity, recreated the load callbacks and
  // re-fired their effects — an unbounded /trade-profiles/me loop that ended at the 429 limiter.
  // Each function below is individually memoized against [user, token], so these identities are
  // stable and the effects run once per mount.
  const {
    fetchOwnDiasporaTradeProfiles,
    listDiasporaTradeProfiles,
    createDiasporaTradeProfile,
    updateDiasporaTradeProfile,
    submitDiasporaTradeProfileForReview,
    verifyDiasporaTradeProfile,
    suspendDiasporaTradeProfile,
  } = useCarUpApi()

  const isReviewer = useMemo(() => reviewerRoles.has((user?.role || '').toLowerCase()), [user?.role])

  const [own, setOwn] = useState<DiasporaTradeProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [ownRateLimited, setOwnRateLimited] = useState(false)

  // create/edit form
  const [roleType, setRoleType] = useState('buyer')
  const [country, setCountry] = useState('')
  const [city, setCity] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formResult, setFormResult] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  // Optimistic-concurrency token captured when editing starts; sent as expected_updated_at so a
  // concurrent change (e.g. a reviewer verifying while you edit) surfaces as a conflict, not a
  // silent overwrite.
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null)
  const [submittingReviewId, setSubmittingReviewId] = useState<string | null>(null)

  // reviewer queue
  const [queue, setQueue] = useState<DiasporaTradeProfile[]>([])
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState('')
  const [queueRateLimited, setQueueRateLimited] = useState(false)
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null)
  const [reviewMessage, setReviewMessage] = useState('')

  // Single-flight guards. A ref (not state) so the check is synchronous: it collapses overlapping
  // calls from effects, rapid clicks and React StrictMode's double-invoked effects into one
  // in-flight request without itself triggering a render.
  const ownInFlight = useRef(false)
  const queueInFlight = useRef(false)
  const savingRef = useRef(false)

  const loadOwn = useCallback(async () => {
    if (!isAuthenticated) return
    if (ownInFlight.current) return
    ownInFlight.current = true
    setLoading(true)
    setLoadError('')
    setOwnRateLimited(false)
    try {
      // /trade-profiles/me returns only the caller's own profiles regardless of privilege.
      setOwn(await fetchOwnDiasporaTradeProfiles())
    } catch (err) {
      // Never auto-retry a 429 — surface a truthful state with a manual retry instead.
      if (isRateLimited(err)) setOwnRateLimited(true)
      else setLoadError(errText(err, 'Unable to load your trade profile'))
    } finally {
      setLoading(false)
      ownInFlight.current = false
    }
  }, [fetchOwnDiasporaTradeProfiles, isAuthenticated])

  const loadQueue = useCallback(async () => {
    if (!isReviewer) return
    if (queueInFlight.current) return
    queueInFlight.current = true
    setQueueLoading(true)
    setQueueError('')
    setQueueRateLimited(false)
    try {
      const data = await listDiasporaTradeProfiles({ verificationStatus: 'PENDING_REVIEW' })
      setQueue(data)
    } catch (err) {
      if (isRateLimited(err)) setQueueRateLimited(true)
      else setQueueError(errText(err, 'Unable to load the review queue'))
    } finally {
      setQueueLoading(false)
      queueInFlight.current = false
    }
  }, [listDiasporaTradeProfiles, isReviewer])

  // Both callbacks now have stable identities, so each effect runs once per authenticated mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadOwn() }, [loadOwn])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadQueue() }, [loadQueue])

  const startEdit = (profile: DiasporaTradeProfile) => {
    setEditingId(profile.id)
    setEditingUpdatedAt(profile.updated_at || null)
    setRoleType((profile.role_type || 'buyer').toLowerCase())
    setCountry(profile.country || '')
    setCity(profile.city || '')
    setFormResult('')
    setFormError('')
  }

  const resetForm = () => {
    setEditingId(null)
    setEditingUpdatedAt(null)
    setRoleType('buyer')
    setCountry('')
    setCity('')
  }

  const submitForm = async () => {
    // Ref guard is synchronous, so a double-click within the same tick cannot produce two PATCHes
    // (the `saving` state alone only updates on the next render).
    if (savingRef.current) return
    if (!country.trim() || !city.trim()) {
      setFormError('Country and city are required.')
      return
    }
    savingRef.current = true
    setSaving(true)
    setFormError('')
    setFormResult('')
    try {
      if (editingId) {
        // Organization membership is intentionally not self-service. Preserve any existing
        // organization assignment by omitting organization_id from user-editable updates.
        await updateDiasporaTradeProfile(editingId, {
          country: country.trim(),
          city: city.trim(),
          expected_updated_at: editingUpdatedAt,
        })
        setFormResult('Profile updated.')
      } else {
        const resolvedRole = roleType === 'supplier' ? SUPPLIER_FALLBACK_ROLE : roleType
        await createDiasporaTradeProfile({
          role_type: resolvedRole,
          country: country.trim(),
          city: city.trim(),
        })
        setFormResult('Profile created and submitted for review.')
      }
      resetForm()
      // Exactly one authoritative refresh after a successful write.
      await loadOwn()
    } catch (err) {
      const message = errText(err, 'Could not save profile')
      if (isRateLimited(err)) {
        setFormError('Too many requests — your change was not saved. Please wait a moment and try again.')
      } else if (/stale|changed since|conflict/i.test(message)) {
        // Stale-edit conflict: the profile changed since this edit began (e.g. reviewer action).
        // Reload the fresh state so the user re-edits against it rather than overwriting blind.
        setFormError('This profile changed while you were editing. It has been reloaded — please re-apply your changes.')
        resetForm()
        await loadOwn()
      } else {
        setFormError(message)
      }
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  const submitForReview = async (id: string) => {
    if (submittingReviewId) return
    setSubmittingReviewId(id)
    setFormError('')
    setFormResult('')
    try {
      await submitDiasporaTradeProfileForReview(id)
      setFormResult('Profile submitted for review.')
      await loadOwn()
    } catch (err) {
      setFormError(isRateLimited(err)
        ? 'Too many requests — please wait a moment and try again.'
        : errText(err, 'Could not submit for review'))
    } finally {
      setSubmittingReviewId(null)
    }
  }

  const review = async (id: string, action: 'verify' | 'suspend') => {
    if (reviewBusyId) return
    setReviewBusyId(id)
    setReviewMessage('')
    try {
      if (action === 'verify') {
        await verifyDiasporaTradeProfile(id)
        setReviewMessage('Profile verified.')
      } else {
        await suspendDiasporaTradeProfile(id, { reason: 'Suspended by reviewer' })
        setReviewMessage('Profile suspended.')
      }
      await Promise.all([loadQueue(), loadOwn()])
    } catch (err) {
      setReviewMessage(isRateLimited(err)
        ? 'Too many requests — please wait a moment and try again.'
        : errText(err, 'Review action failed'))
    } finally {
      setReviewBusyId(null)
    }
  }

  if (!authLoading && !isAuthenticated) {
    return <Navigate to={buildLoginRedirect('/diaspora/trade-profile')} replace />
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8" data-testid="diaspora-trade-profile-route">
      <div className="flex items-center gap-2">
        <UserCog className="h-6 w-6 text-orange-600" />
        <h1 className="text-2xl font-bold text-gray-950">Trade profile</h1>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Manage your buyer, seller, or supplier trade profile. New and edited profiles are reviewed
        before they are marked verified — you cannot self-verify.
      </p>

      {/* Own profile(s) */}
      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4" data-testid="diaspora-trade-profile-own">
        <h2 className="text-base font-semibold text-gray-900">Your profile</h2>
        {loading && <div className="mt-3 flex items-center gap-2 text-orange-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {!loading && ownRateLimited && (
          <Alert className="mt-3 border-amber-200" data-testid="diaspora-trade-profile-rate-limited">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Too many requests</AlertTitle>
            <AlertDescription>
              <span className="block">
                You have reached the request limit for now. Nothing is being retried automatically —
                please wait about a minute, then retry.
              </span>
              <Button size="sm" variant="outline" className="mt-2" onClick={loadOwn} data-testid="diaspora-trade-profile-retry">
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {!loading && loadError && (
          <Alert className="mt-3 border-red-200" data-testid="diaspora-trade-profile-load-error">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Unable to load</AlertTitle>
            <AlertDescription>
              <span className="block">{loadError}</span>
              <Button size="sm" variant="outline" className="mt-2" onClick={loadOwn} data-testid="diaspora-trade-profile-retry">
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {!loading && !loadError && !ownRateLimited && own.length === 0 && <p className="mt-3 text-sm text-gray-500" data-testid="diaspora-trade-profile-empty">You have no trade profile yet. Create one below.</p>}
        {own.length > 0 && (
          <ul className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-100" data-testid="diaspora-trade-profile-own-list">
            {own.map(p => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-testid="diaspora-trade-profile-own-row">
                <span className="font-medium text-gray-900">{(p.role_type || 'buyer')} · {p.city || '—'}, {p.country || '—'}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={statusVariant(p.verification_status)}>{p.verification_status || 'PENDING_REVIEW'}</Badge>
                  {String(p.verification_status || '').toUpperCase() === 'REJECTED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={submittingReviewId === p.id}
                      onClick={() => submitForReview(p.id)}
                      data-testid="diaspora-trade-profile-submit-review"
                    >
                      {submittingReviewId === p.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                      Resubmit for review
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => startEdit(p)} data-testid="diaspora-trade-profile-edit">Edit</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Create / edit form */}
      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4" data-testid="diaspora-trade-profile-form">
        <h2 className="text-base font-semibold text-gray-900">{editingId ? 'Edit profile' : 'Create profile'}</h2>
        <p className="mt-1 text-xs text-gray-500" data-testid="diaspora-trade-profile-organization-note">
          Organization membership is assigned from an approved organization record by an authorized administrator; it cannot be entered as free text.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-gray-700">
            Role
            <select
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
              value={roleType}
              onChange={event => setRoleType(event.target.value)}
              disabled={Boolean(editingId)}
              data-testid="diaspora-trade-profile-role"
            >
              {ROLE_TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Country
            <Input value={country} onChange={event => setCountry(event.target.value)} className="mt-1" data-testid="diaspora-trade-profile-country" />
          </label>
          <label className="text-sm text-gray-700">
            City
            <Input value={city} onChange={event => setCity(event.target.value)} className="mt-1" data-testid="diaspora-trade-profile-city" />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" disabled={saving} onClick={submitForm} data-testid="diaspora-trade-profile-submit">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create profile'}
          </Button>
          {editingId && <Button size="sm" variant="ghost" onClick={resetForm} data-testid="diaspora-trade-profile-cancel">Cancel</Button>}
        </div>
        <p aria-live="polite" className="mt-2 text-sm">
          {formResult && <span className="font-medium text-green-700" data-testid="diaspora-trade-profile-result">{formResult}</span>}
          {formError && <span className="font-medium text-red-700" data-testid="diaspora-trade-profile-error">{formError}</span>}
        </p>
      </section>

      {/* Reviewer console */}
      {isReviewer && (
        <section className="mt-6 rounded-lg border border-orange-200 bg-white p-4" data-testid="diaspora-trade-profile-review-console">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-orange-600" />
            <h2 className="text-base font-semibold text-gray-900">Reviewer console — pending verification</h2>
          </div>
          {queueLoading && <div className="mt-3 flex items-center gap-2 text-orange-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading queue…</div>}
          {!queueLoading && queueRateLimited && (
            <Alert className="mt-3 border-amber-200" data-testid="diaspora-trade-profile-queue-rate-limited">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Too many requests</AlertTitle>
              <AlertDescription>
                <span className="block">
                  The review queue hit the request limit. Nothing is being retried automatically —
                  please wait about a minute, then retry.
                </span>
                <Button size="sm" variant="outline" className="mt-2" onClick={loadQueue} data-testid="diaspora-trade-profile-queue-retry">
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!queueLoading && queueError && (
            <Alert className="mt-3 border-red-200" data-testid="diaspora-trade-profile-queue-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <span className="block">{queueError}</span>
                <Button size="sm" variant="outline" className="mt-2" onClick={loadQueue} data-testid="diaspora-trade-profile-queue-retry">
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!queueLoading && !queueError && !queueRateLimited && queue.length === 0 && <p className="mt-3 text-sm text-gray-500" data-testid="diaspora-trade-profile-queue-empty">No profiles awaiting review.</p>}
          {queue.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <Table data-testid="diaspora-trade-profile-queue">
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.map(p => (
                    <TableRow key={p.id} data-testid="diaspora-trade-profile-queue-row">
                      <TableCell className="font-medium">{p.role_type || 'buyer'}</TableCell>
                      <TableCell>{p.city || '—'}, {p.country || '—'}</TableCell>
                      <TableCell><Badge variant={statusVariant(p.verification_status)}>{p.verification_status || 'PENDING_REVIEW'}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" disabled={reviewBusyId === p.id} onClick={() => review(p.id, 'verify')} data-testid="diaspora-trade-profile-verify">
                            <BadgeCheck className="mr-1 h-3.5 w-3.5" /> Verify
                          </Button>
                          <Button size="sm" variant="destructive" disabled={reviewBusyId === p.id} onClick={() => review(p.id, 'suspend')} data-testid="diaspora-trade-profile-suspend">
                            <Ban className="mr-1 h-3.5 w-3.5" /> Suspend
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p aria-live="polite" className="mt-2 text-sm font-medium text-gray-700" data-testid="diaspora-trade-profile-review-message">{reviewMessage}</p>
        </section>
      )}
    </div>
  )
}
