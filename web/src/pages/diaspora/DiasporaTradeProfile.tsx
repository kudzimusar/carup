import { useCallback, useEffect, useMemo, useState } from 'react'
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

export default function DiasporaTradeProfile() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()

  const isReviewer = useMemo(() => reviewerRoles.has((user?.role || '').toLowerCase()), [user?.role])

  const [own, setOwn] = useState<DiasporaTradeProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  // create/edit form
  const [roleType, setRoleType] = useState('buyer')
  const [country, setCountry] = useState('')
  const [city, setCity] = useState('')
  const [org, setOrg] = useState('')
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
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null)
  const [reviewMessage, setReviewMessage] = useState('')

  const loadOwn = useCallback(async () => {
    if (!isAuthenticated) return
    setLoading(true)
    setLoadError('')
    try {
      // /trade-profiles/me returns only the caller's own profiles regardless of privilege.
      setOwn(await api.fetchOwnDiasporaTradeProfiles())
    } catch (err) {
      setLoadError(errText(err, 'Unable to load your trade profile'))
    } finally {
      setLoading(false)
    }
  }, [api, isAuthenticated])

  const loadQueue = useCallback(async () => {
    if (!isReviewer) return
    setQueueLoading(true)
    setQueueError('')
    try {
      const data = await api.listDiasporaTradeProfiles({ verificationStatus: 'PENDING_REVIEW' })
      setQueue(data)
    } catch (err) {
      setQueueError(errText(err, 'Unable to load the review queue'))
    } finally {
      setQueueLoading(false)
    }
  }, [api, isReviewer])

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
    setOrg(profile.organization_id || '')
    setFormResult('')
    setFormError('')
  }

  const resetForm = () => {
    setEditingId(null)
    setEditingUpdatedAt(null)
    setRoleType('buyer')
    setCountry('')
    setCity('')
    setOrg('')
  }

  const submitForm = async () => {
    if (saving) return
    if (!country.trim() || !city.trim()) {
      setFormError('Country and city are required.')
      return
    }
    setSaving(true)
    setFormError('')
    setFormResult('')
    try {
      if (editingId) {
        await api.updateDiasporaTradeProfile(editingId, {
          country: country.trim(),
          city: city.trim(),
          organization_id: org.trim() || null,
          expected_updated_at: editingUpdatedAt,
        })
        setFormResult('Profile updated.')
      } else {
        const resolvedRole = roleType === 'supplier' ? SUPPLIER_FALLBACK_ROLE : roleType
        await api.createDiasporaTradeProfile({
          role_type: resolvedRole,
          country: country.trim(),
          city: city.trim(),
          organization_id: org.trim() || null,
        })
        setFormResult('Profile created and submitted for review.')
      }
      resetForm()
      await loadOwn()
    } catch (err) {
      const message = errText(err, 'Could not save profile')
      // Stale-edit conflict: the profile changed since this edit began (e.g. reviewer action).
      // Reload the fresh state so the user re-edits against it rather than overwriting blind.
      if (/stale|changed since|conflict/i.test(message)) {
        setFormError('This profile changed while you were editing. It has been reloaded — please re-apply your changes.')
        resetForm()
        await loadOwn()
      } else {
        setFormError(message)
      }
    } finally {
      setSaving(false)
    }
  }

  const submitForReview = async (id: string) => {
    if (submittingReviewId) return
    setSubmittingReviewId(id)
    setFormError('')
    setFormResult('')
    try {
      await api.submitDiasporaTradeProfileForReview(id)
      setFormResult('Profile submitted for review.')
      await loadOwn()
    } catch (err) {
      setFormError(errText(err, 'Could not submit for review'))
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
        await api.verifyDiasporaTradeProfile(id)
        setReviewMessage('Profile verified.')
      } else {
        await api.suspendDiasporaTradeProfile(id, { reason: 'Suspended by reviewer' })
        setReviewMessage('Profile suspended.')
      }
      await Promise.all([loadQueue(), loadOwn()])
    } catch (err) {
      setReviewMessage(errText(err, 'Review action failed'))
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
        {loadError && <Alert className="mt-3 border-red-200" data-testid="diaspora-trade-profile-load-error"><AlertCircle className="h-4 w-4" /><AlertTitle>Unable to load</AlertTitle><AlertDescription>{loadError}</AlertDescription></Alert>}
        {!loading && own.length === 0 && <p className="mt-3 text-sm text-gray-500" data-testid="diaspora-trade-profile-empty">You have no trade profile yet. Create one below.</p>}
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
            Organization (optional)
            <Input value={org} onChange={event => setOrg(event.target.value)} className="mt-1" data-testid="diaspora-trade-profile-org" />
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
            {editingId ? 'Save changes' : 'Create profile'}
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
          {queueError && <Alert className="mt-3 border-red-200" data-testid="diaspora-trade-profile-queue-error"><AlertCircle className="h-4 w-4" /><AlertDescription>{queueError}</AlertDescription></Alert>}
          {!queueLoading && queue.length === 0 && <p className="mt-3 text-sm text-gray-500" data-testid="diaspora-trade-profile-queue-empty">No profiles awaiting review.</p>}
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
