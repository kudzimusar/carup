import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCommunicationCapabilityState } from '@/hooks/useCommunicationCapability'
import {
  CHANNEL_ROWS,
  CONSENT_ROWS,
  PREFERENCE_SAVED,
  PREFERENCE_SAVE_FAILED,
  PREFERENCES_READ_FAILED,
  channelControl,
  preferencesFrom,
  readPreferenceView,
  type PreferenceView,
} from './deliveryPreferences'

/**
 * Channels & consent (CARUP-MVP-STAB-01 F-018). The rules live in ./deliveryPreferences; this card
 * only renders them: no switch before a successful read, one preference per save, a failure said out
 * loud, and a channel offered as a working switch only while the runtime can deliver on it.
 */
export function DeliveryPreferencesCard({
  read,
  save,
}: {
  read: () => Promise<unknown>
  save: (patch: Record<string, boolean>) => Promise<unknown>
}) {
  const { capability, checking } = useCommunicationCapabilityState()
  const [view, setView] = useState<PreferenceView>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'saved' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let live = true
    void readPreferenceView(read).then((next) => { if (live) setView(next) })
    return () => { live = false }
  }, [read, attempt])

  function retry() {
    setView({ state: 'loading' })
    setNotice(null)
    setAttempt((count) => count + 1)
  }

  async function change(key: string, value: boolean) {
    // D2: nothing changes before the current values were read, and one change at a time.
    if (view.state !== 'ready' || savingKey) return
    const confirmedBefore = view.preferences
    setSavingKey(key)
    setNotice(null)
    try {
      const confirmed = preferencesFrom(await save({ [key]: value }))
      if (!confirmed) throw new Error('CarUp returned no preference values')
      const next = { ...confirmedBefore, ...confirmed }
      setView({ state: 'ready', preferences: next })
      setNotice(Boolean(next[key]) === value
        ? { tone: 'saved', text: PREFERENCE_SAVED }
        : { tone: 'error', text: PREFERENCE_SAVE_FAILED })
    } catch {
      // The switches keep the last values CarUp confirmed; nothing is claimed that was not saved.
      setNotice({ tone: 'error', text: PREFERENCE_SAVE_FAILED })
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Card className="border-0 card-shadow" data-testid="delivery-preferences" data-state={view.state}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <SlidersHorizontal className="h-5 w-5 text-orange-500" aria-hidden="true" /> Channels & consent
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {view.state === 'loading' ? (
          <p className="text-sm text-gray-500" data-testid="delivery-preferences-loading">Loading your delivery preferences…</p>
        ) : view.state === 'read_failed' ? (
          <div data-testid="delivery-preferences-read-failed">
            <p className="text-sm font-medium text-gray-800">{PREFERENCES_READ_FAILED}</p>
            <p className="mt-1 text-xs text-gray-500">Nothing is shown or changed until CarUp can read your current choices.</p>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={retry} data-testid="delivery-preferences-retry">
              Try again
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3" data-testid="delivery-preferences-consent">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Consent</p>
              {CONSENT_ROWS.map((row) => (
                <div key={row.key} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Label htmlFor={`pref-${row.key}`}>{row.label}</Label>
                    <p className="mt-0.5 text-[11px] text-gray-500">{row.description}</p>
                  </div>
                  <Switch
                    id={`pref-${row.key}`}
                    checked={Boolean(view.preferences[row.key])}
                    disabled={Boolean(savingKey)}
                    onCheckedChange={(checked) => void change(row.key, checked)}
                    data-testid={`delivery-pref-${row.key}`}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-3" data-testid="delivery-preferences-channels">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Delivery channels</p>
              {CHANNEL_ROWS.map((row) => {
                const control = channelControl(capability, row.channel, { checking })
                return (
                  <div key={row.key} className="flex items-start justify-between gap-3" data-availability={control.availability}>
                    <div className="min-w-0">
                      <Label htmlFor={`pref-${row.key}`}>{row.label}</Label>
                      <p
                        id={`pref-${row.key}-availability`}
                        className={`mt-0.5 text-[11px] ${control.editable ? 'text-gray-400' : 'text-gray-500'}`}
                        data-testid={`delivery-pref-${row.key}-availability`}
                      >
                        {control.note}
                      </p>
                    </div>
                    <Switch
                      id={`pref-${row.key}`}
                      checked={Boolean(view.preferences[row.key])}
                      disabled={!control.editable || Boolean(savingKey)}
                      aria-describedby={`pref-${row.key}-availability`}
                      onCheckedChange={(checked) => void change(row.key, checked)}
                      data-testid={`delivery-pref-${row.key}`}
                    />
                  </div>
                )
              })}
            </div>
            {notice && (
              <p
                role="status"
                className={`text-xs ${notice.tone === 'error' ? 'text-red-600' : 'text-gray-500'}`}
                data-testid="delivery-preferences-status"
              >
                {notice.text}
              </p>
            )}
          </>
        )}
        <p className="text-[11px] text-gray-500">
          Transactional and marketing consent are independent. Channel availability never opts you into marketing, and delivery suppression does not delete the CarUp conversation.
        </p>
      </CardContent>
    </Card>
  )
}
