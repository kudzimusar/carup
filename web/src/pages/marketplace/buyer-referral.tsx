import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ShoppingCart } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Buyer Referral Capture (/marketplace/buyer-referral)
 * Capture referral code on buyer inquiry. Validates the code before submitting.
 * No admin capability — purely the buyer-side attribution capture.
 */

export default function BuyerReferral() {
  const { captureBuyerReferral, validateReferralCode } = useCarUpApi()
  const [code, setCode] = useState('')
  const [listingId, setListingId] = useState('')
  const [note, setNote] = useState('')
  const [validation, setValidation] = useState<{ valid: boolean; reason?: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checkCode = useCallback(async () => {
    if (!code.trim()) return
    setChecking(true)
    setValidation(null)
    try {
      const res = await validateReferralCode({ code: code.trim() })
      setValidation(res)
    } catch { setValidation(null) }
    finally { setChecking(false) }
  }, [code, validateReferralCode])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const res = await captureBuyerReferral({ referral_code: code.trim() || undefined, listing_id: listingId.trim() || undefined, metadata: { note } })
      setResult('Referral captured. Event ID: ' + res.event?.id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-lg space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingCart className="h-6 w-6" /> Apply Referral Code</h1>
      <p className="text-sm text-gray-500">If you were referred to CarUp, enter the code below to credit your referrer.</p>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}
      {result && <p className="text-sm text-green-600 bg-green-50 p-3 rounded">{result}</p>}

      <Card>
        <CardContent className="p-5 space-y-4">
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">Referral Code</label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. ABC-12345"
                  value={code}
                  onChange={e => { setCode(e.target.value.toUpperCase()); setValidation(null) }}
                  className="font-mono uppercase"
                />
                <Button type="button" variant="outline" onClick={checkCode} disabled={checking || !code.trim()}>
                  {checking ? '…' : 'Check'}
                </Button>
              </div>
              {validation !== null && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={validation.valid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                    {validation.valid ? 'Valid' : `Invalid: ${validation.reason}`}
                  </Badge>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-500">Listing ID (optional)</label>
              <Input placeholder="CarUp listing reference" value={listingId} onChange={e => setListingId(e.target.value)} />
            </div>

            <div>
              <label className="text-xs text-gray-500">Note (optional)</label>
              <Textarea placeholder="How did you hear about this?" value={note} onChange={e => setNote(e.target.value)} rows={2} />
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Submitting…' : 'Submit Referral'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}