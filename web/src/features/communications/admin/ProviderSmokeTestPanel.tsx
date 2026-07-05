// Provider smoke-test panel for the Command Center ops rail (docs §9).
// Self-contained: owns the recipient/busy/result state and calls the injected send function.
// A green result means a REAL provider request was made (the server refuses fake adapters).

import { useState } from 'react'
import { CheckCircle2, Loader2, MessageCircle, Send, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export interface SmokeSendResult {
  ok: boolean
  provider?: string
  error?: string
  message?: string
  delivery?: { provider_message_id?: string | null; status?: string | null; error_message?: string | null }
}

export interface ProviderSmokeTestPanelProps {
  onSend: (payload: { channel: string; to: string }) => Promise<SmokeSendResult>
  defaultRecipient?: string
  onDone?: () => void
}

export function ProviderSmokeTestPanel({ onSend, defaultRecipient = '', onDone }: ProviderSmokeTestPanelProps) {
  const [to, setTo] = useState(defaultRecipient)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SmokeSendResult | null>(null)

  const run = async () => {
    const recipient = to.trim()
    if (!recipient) return
    setBusy(true)
    setResult(null)
    try {
      setResult(await onSend({ channel: 'whatsapp', to: recipient }))
    } catch (err) {
      setResult({ ok: false, error: 'request_failed', message: err instanceof Error ? err.message : 'Request failed' })
    } finally {
      setBusy(false)
      onDone?.()
    }
  }

  return (
    <Card className="border-0 card-shadow">
      <CardHeader className="pb-3"><CardTitle className="text-lg flex items-center gap-2"><MessageCircle className="w-4 h-4" aria-hidden /> WhatsApp smoke test</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-xs text-gray-500">Sends one real WhatsApp message through the engine. The server refuses fake adapters, so a green result means a real Meta request was made.</p>
        <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Recipient E.164 e.g. 818081201356" aria-label="Smoke test recipient phone number in E.164" className="h-9" />
        <Button size="sm" className="w-full gap-1" disabled={busy || !to.trim()} onClick={run}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <Send className="w-3 h-3" aria-hidden />}
          {busy ? 'Sending…' : 'Send WhatsApp smoke test'}
        </Button>
        {result && (
          <div className={`text-xs rounded p-2 ${result.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`} aria-live="polite">
            {result.ok ? (
              <>
                <div className="font-medium flex items-center gap-1"><CheckCircle2 className="w-3 h-3" aria-hidden />Sent via {result.provider}</div>
                <div className="break-all">provider_message_id: {result.delivery?.provider_message_id}</div>
                <div>status: {result.delivery?.status}</div>
              </>
            ) : (
              <>
                <div className="font-medium flex items-center gap-1"><XCircle className="w-3 h-3" aria-hidden />{result.error || 'Failed'}</div>
                <div className="break-words">{result.message || result.delivery?.error_message}</div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
