import { useState } from 'react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Sparkles, Loader2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * AI buyer assistant entry point. Calls the advisory backend endpoint, which ALWAYS returns useful
 * guidance (deterministic fallback when the AI provider is unavailable). An ai_unavailable state is
 * surfaced honestly rather than faked.
 */
export function BuyerAssistantDrawer({ triggerClassName = '' }: { triggerClassName?: string }) {
  const { marketplaceAiBuyerAssistant } = useCarUpApi()
  const [open, setOpen] = useState(false)
  const [budget, setBudget] = useState('')
  const [useCase, setUseCase] = useState('')
  const [loading, setLoading] = useState(false)
  const [guidance, setGuidance] = useState<string[]>([])
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null)

  const ask = async () => {
    setLoading(true)
    try {
      const res = await marketplaceAiBuyerAssistant({ budget: budget ? Number(budget) : undefined, use_case: useCase || undefined })
      setGuidance(Array.isArray(res?.guidance) ? res.guidance : [])
      setAiAvailable(res?.ai_available ?? false)
    } catch {
      setGuidance(['Use the verified inquiry flow and request an inspection before paying. Never pay outside CarUp.'])
      setAiAvailable(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className={triggerClassName} data-testid="marketplace-ai-assistant-open">
          <Sparkles className="mr-2 h-4 w-4 text-orange-500" /> Ask CarUp AI
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[90%] max-w-md overflow-y-auto" data-testid="marketplace-ai-assistant">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-orange-500" /> AI buyer assistant</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Budget (USD)</label>
            <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 12000" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">What will you use it for?</label>
            <Input value={useCase} onChange={(e) => setUseCase(e.target.value)} placeholder="e.g. family car, business, import" />
          </div>
          <Button onClick={ask} disabled={loading} className="w-full" data-testid="marketplace-ai-assistant-ask">
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Thinking…</> : 'Get guidance'}
          </Button>

          {guidance.length > 0 && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3" data-testid="marketplace-ai-assistant-result">
              {aiAvailable === false && (
                <Badge variant="outline" className="mb-2 text-[10px] text-amber-700">AI unavailable — showing safe guidance</Badge>
              )}
              <ul className="space-y-1.5">
                {guidance.map((g, i) => (
                  <li key={i} className="text-xs text-gray-700">• {g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
