import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Bell } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Consent & Preferences (/dashboard/referrals/preferences)
 * Opt in / out of WhatsApp, Telegram, Email, SMS, Social per-channel.
 * Language preference selection (en / sn / nd).
 */

const CHANNELS = ['whatsapp', 'telegram', 'email', 'sms', 'social'] as const
type Channel = typeof CHANNELS[number]
const LANGUAGES = ['en', 'sn', 'nd'] as const
type Lang = typeof LANGUAGES[number]
const LANG_LABELS: Record<Lang, string> = { en: 'English', sn: 'Shona', nd: 'Ndebele' }

type Preference = { channel: Channel; opted_in: boolean; language: Lang }

export default function ConsentPreferences() {
  const { getChannelPreferences, upsertChannelPreference } = useCarUpApi()
  const [prefs, setPrefs] = useState<Preference[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<Channel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getChannelPreferences()
      setPrefs(res.preferences ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load preferences')
    } finally {
      setLoading(false)
    }
  }, [getChannelPreferences])

  useEffect(() => { load() }, [load])

  const getPref = (ch: Channel): Preference =>
    prefs.find(p => p.channel === ch) ?? { channel: ch, opted_in: false, language: 'en' }

  const toggle = async (ch: Channel) => {
    const current = getPref(ch)
    setSaving(ch)
    setSuccessMsg(null)
    setError(null)
    try {
      await upsertChannelPreference({ channel: ch, opted_in: !current.opted_in, language: current.language })
      setSuccessMsg(`${ch} preference updated.`)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(null)
    }
  }

  const setLanguage = async (ch: Channel, language: Lang) => {
    const current = getPref(ch)
    setSaving(ch)
    try {
      await upsertChannelPreference({ channel: ch, opted_in: current.opted_in, language })
      await load()
    } catch { /* silent */ }
    finally { setSaving(null) }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="h-6 w-6" /> Notification Preferences
        </h1>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>
      <p className="text-sm text-gray-500">
        Control which channels CarUp may contact you on about referral campaigns and trade updates.
      </p>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}
      {successMsg && <p className="text-sm text-green-600 bg-green-50 p-3 rounded">{successMsg}</p>}

      <div className="space-y-3">
        {CHANNELS.map(ch => {
          const pref = getPref(ch)
          return (
            <Card key={ch}>
              <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="font-medium capitalize">{ch}</p>
                    <Badge className={pref.opted_in ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}>
                      {pref.opted_in ? 'Opted In' : 'Opted Out'}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="border rounded px-2 py-1 text-xs"
                    value={pref.language}
                    onChange={e => setLanguage(ch, e.target.value as Lang)}
                    disabled={saving === ch}
                  >
                    {LANGUAGES.map(l => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
                  </select>
                  <Button
                    size="sm"
                    variant={pref.opted_in ? 'outline' : 'default'}
                    onClick={() => toggle(ch)}
                    disabled={saving === ch}
                  >
                    {saving === ch ? '…' : pref.opted_in ? 'Opt Out' : 'Opt In'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}