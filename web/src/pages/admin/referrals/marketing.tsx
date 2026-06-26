import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Globe } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Multilingual Marketing Drafts (/admin/referrals/marketing)
 * Fetch drafts from API, display side-by-side per language.
 * Clearly marked: requires human review and approval before any publication.
 */

const LANGUAGES = ['en', 'sn', 'nd'] as const
type Lang = typeof LANGUAGES[number]
const LANG_LABELS: Record<Lang, string> = { en: 'English', sn: 'Shona', nd: 'Ndebele' }
type Drafts = Record<string, string>

export default function MultilingualDrafts() {
  const { getMarketingDrafts } = useCarUpApi()
  const [lang, setLang] = useState<Lang>('en')
  const [drafts, setDrafts] = useState<Drafts | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (l: Lang) => {
    setLoading(true)
    setError(null)
    try {
      const res = await getMarketingDrafts(l)
      setDrafts(res.draft ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load drafts')
    } finally {
      setLoading(false)
    }
  }, [getMarketingDrafts])

  useEffect(() => { load(lang) }, [lang, load])

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Globe className="h-6 w-6" /> Multilingual Marketing Drafts
        </h1>
        <Button variant="ghost" size="sm" onClick={() => load(lang)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="bg-amber-50 border border-amber-200 text-amber-700 p-3 rounded text-sm">
        ⚠️ All drafts below require explicit human review and approval before publication. Do not publish without sign-off.
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}

      <div className="flex gap-2">
        {LANGUAGES.map(l => (
          <Button
            key={l}
            size="sm"
            variant={lang === l ? 'default' : 'outline'}
            onClick={() => setLang(l)}
          >
            {LANG_LABELS[l]}
          </Button>
        ))}
      </div>

      {drafts && (
        <div className="space-y-4">
          {Object.entries(drafts).filter(([k]) => !k.startsWith('_')).map(([key, value]) => (
            <Card key={key}>
              <CardContent className="p-4 space-y-1">
                <p className="text-xs font-mono text-gray-400">{key}</p>
                <p className="text-sm text-gray-800">{value}</p>
                <Badge className="bg-gray-100 text-gray-600 text-xs">Draft — Requires Human Approval</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!drafts && !loading && <p className="text-sm text-gray-500">No drafts loaded.</p>}
    </div>
  )
}