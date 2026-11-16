import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2, Globe, EyeOff } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SERVICE_CATEGORIES } from '@/lib/serviceRequests'
import { SN_PAGE, SN_FORM_COLUMN } from '@/lib/serviceNetworkLayout'

/**
 * The garage's own public page (R5).
 *
 * Owner UAT: `GET/PUT /api/garage/profile` and its publish/unpublish endpoints were certified and
 * had no surface, so a garage could not appear in the directory at all without someone calling the
 * API by hand. That makes the entire owner journey supply-less: there is nobody to request service
 * from. This is the smallest screen that fixes it.
 *
 * Publication has real preconditions in the backend (a name, a city and at least one service
 * category). They are stated here BEFORE the button is pressed, because a validation error that
 * arrives after a click cannot tell you what to type.
 *
 * The page is honest about what publishing means: it makes the garage findable. It is not a
 * CarUp endorsement, and nothing here says it is.
 */

type Profile = {
  display_name: string | null
  slug: string | null
  description: string | null
  location_city: string | null
  location_province: string | null
  contact_policy: string | null
  public_phone: string | null
  service_categories: string[] | null
  publication_status: string | null
}

const EMPTY: Profile = {
  display_name: '', slug: null, description: '', location_city: '', location_province: '',
  contact_policy: 'in_app_only', public_phone: '', service_categories: [], publication_status: 'draft',
}

/** The backend's publish preconditions, stated where they can still be acted on. */
function missingForPublication(p: Profile): string[] {
  const missing: string[] = []
  if (!p.display_name || p.display_name.trim().length < 2) missing.push('a garage name')
  if (!p.location_city || !p.location_city.trim()) missing.push('the city you are in')
  if (!p.service_categories || p.service_categories.length === 0) missing.push('at least one kind of work you do')
  return missing
}

export default function GarageProfileEditor() {
  const { fetchMyGarageProfile, saveMyGarageProfile, publishMyGarageProfile, unpublishMyGarageProfile } = useCarUpApi()

  const [profile, setProfile] = useState<Profile>(EMPTY)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchMyGarageProfile()
      .then((res) => {
        const p = res?.profile
        setProfile(p ? { ...EMPTY, ...p, service_categories: p.service_categories || [] } : EMPTY)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [fetchMyGarageProfile])

  useEffect(() => { load() }, [load])

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true); setError(null); setNotice(null)
    try {
      await fn()
      setNotice(success)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  function toggleCategory(value: string) {
    setProfile((p) => {
      const current = p.service_categories || []
      return {
        ...p,
        service_categories: current.includes(value)
          ? current.filter((c) => c !== value)
          : [...current, value],
      }
    })
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-3 p-8" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
        <span className="text-sm text-gray-600">Loading your garage page…</span>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <Card className={`border-0 card-shadow ${SN_FORM_COLUMN} mx-auto`} data-testid="profile-error">
        <CardContent className="p-6 text-center">
          <p className="font-semibold text-gray-800">Your garage page could not be loaded</p>
          <p className="text-sm text-gray-500 mt-1">
            This is a loading problem, not a statement that you have no garage page.
          </p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={() => { setState('loading'); load() }}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  const published = profile.publication_status === 'published'
  const missing = missingForPublication(profile)

  return (
    <div className={`${SN_PAGE} ${SN_FORM_COLUMN}`}>
      <Link to="/garage" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Workshop
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My garage page</h1>
          <p className="text-gray-500">What customers see when they find you on CarUp</p>
        </div>
        <Badge className={published ? 'bg-green-600 text-white' : 'bg-gray-400 text-white'} data-testid="publication-status">
          {published ? 'Visible to customers' : 'Not visible yet'}
        </Badge>
      </div>

      {notice && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status" data-testid="profile-notice">{notice}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="profile-save-error">{error}</p>}

      <Card className="border-0 card-shadow">
        <CardContent className="p-5 space-y-4">
          <div>
            <label htmlFor="display-name" className="block text-sm font-medium mb-1">Garage name</label>
            <input
              id="display-name" value={profile.display_name || ''} data-testid="profile-name"
              onChange={(e) => setProfile((p) => ({ ...p, display_name: e.target.value }))}
              className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium mb-1">
              About your garage <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="description" rows={3} value={profile.description || ''} data-testid="profile-description"
              onChange={(e) => setProfile((p) => ({ ...p, description: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 p-3 text-sm"
              placeholder="What you specialise in, how long you have been open, which makes you know best."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="city" className="block text-sm font-medium mb-1">City</label>
              <input
                id="city" value={profile.location_city || ''} data-testid="profile-city"
                onChange={(e) => setProfile((p) => ({ ...p, location_city: e.target.value }))}
                className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="province" className="block text-sm font-medium mb-1">
                Province <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="province" value={profile.location_province || ''} data-testid="profile-province"
                onChange={(e) => setProfile((p) => ({ ...p, location_province: e.target.value }))}
                className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
              />
            </div>
          </div>

          <fieldset>
            <legend className="block text-sm font-medium mb-2">What work do you do?</legend>
            <div className="flex flex-wrap gap-2" data-testid="profile-categories">
              {SERVICE_CATEGORIES.filter((c) => c.value !== 'other').map((c) => {
                const on = (profile.service_categories || []).includes(c.value)
                return (
                  <button
                    key={c.value} type="button" onClick={() => toggleCategory(c.value)}
                    aria-pressed={on} data-testid={`category-${c.value}`}
                    className={`min-h-11 px-3 rounded-full border text-sm ${
                      on ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-700 border-gray-300'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor="contact-policy" className="block text-sm font-medium mb-1">How customers reach you</label>
            <select
              id="contact-policy" value={profile.contact_policy || 'in_app_only'} data-testid="profile-contact-policy"
              onChange={(e) => setProfile((p) => ({ ...p, contact_policy: e.target.value }))}
              className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
            >
              <option value="in_app_only">Through CarUp only</option>
              <option value="phone_public">Show my phone number publicly</option>
            </select>
            {profile.contact_policy === 'phone_public' && (
              <input
                value={profile.public_phone || ''} data-testid="profile-phone" aria-label="Public phone number"
                onChange={(e) => setProfile((p) => ({ ...p, public_phone: e.target.value }))}
                className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm mt-2"
                placeholder="The number you are happy for anyone to see"
              />
            )}
          </div>

          <Button
            className="w-full min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="save-profile"
            onClick={() => run(() => saveMyGarageProfile({
              display_name: profile.display_name || '',
              description: profile.description || null,
              location_city: profile.location_city || null,
              location_province: profile.location_province || null,
              contact_policy: profile.contact_policy || 'in_app_only',
              public_phone: profile.public_phone || null,
              service_categories: profile.service_categories || [],
            }), 'Saved.')}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-0 card-shadow">
        <CardContent className="p-5 space-y-3">
          <p className="font-semibold flex items-center gap-2">
            {published
              ? <><Globe className="w-4 h-4 text-green-600" aria-hidden="true" /> Customers can find you</>
              : <><EyeOff className="w-4 h-4 text-gray-400" aria-hidden="true" /> Customers cannot find you yet</>}
          </p>

          {published ? (
            <>
              <p className="text-sm text-gray-600">
                Your page is in the CarUp garage directory and customers can send you service
                requests. Being listed is not a CarUp endorsement — CarUp has not inspected your work.
              </p>
              <div className="flex flex-wrap gap-2">
                {profile.slug && (
                  <Link to={`/garages/${profile.slug}`}>
                    <Button variant="outline" className="min-h-11" data-testid="view-public-page">See my public page</Button>
                  </Link>
                )}
                <Button
                  variant="outline" className="min-h-11" disabled={busy} data-testid="unpublish-profile"
                  onClick={() => run(() => unpublishMyGarageProfile(), 'Taken down. Customers can no longer find you.')}
                >
                  Take my page down
                </Button>
              </div>
            </>
          ) : missing.length ? (
            <div data-testid="publish-blocked">
              <p className="text-sm text-gray-600">Before customers can find you, add:</p>
              <ul className="text-sm text-gray-700 list-disc pl-5 mt-2 space-y-1">
                {missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
              <p className="text-xs text-gray-500 mt-2">Save your changes first, then publish.</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Publishing puts you in the CarUp garage directory so customers can send you service
                requests. You can take it down again at any time.
              </p>
              <Button
                className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="publish-profile"
                onClick={() => run(() => publishMyGarageProfile(), 'Published. Customers can find you now.')}
              >
                Publish my garage page
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
