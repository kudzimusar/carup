import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Check, Copy, Mail, MessageCircle, MoreHorizontal, Send, Share2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

interface MarketplaceShareSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  url: string
}

function popup(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer,width=720,height=640')
}

export function MarketplaceShareSheet({ open, onOpenChange, title, url }: MarketplaceShareSheetProps) {
  const [copied, setCopied] = useState(false)
  const encodedUrl = encodeURIComponent(url)
  const encodedText = encodeURIComponent(`Check out ${title} on CarUp`)

  const copy = async () => {
    await navigator.clipboard?.writeText(url)
    setCopied(true)
    toast.success('Listing link copied')
    window.setTimeout(() => setCopied(false), 1800)
  }

  const nativeShare = async () => {
    if (!navigator.share) return copy()
    try {
      await navigator.share({ title, text: `Check out ${title} on CarUp`, url })
    } catch {
      // Native share-sheet dismissal is not an error.
    }
  }

  const actions = [
    { label: 'WhatsApp', icon: MessageCircle, action: () => popup(`https://wa.me/?text=${encodedText}%20${encodedUrl}`) },
    { label: 'Facebook', icon: Share2, action: () => popup(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`) },
    { label: 'X', icon: Send, action: () => popup(`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`) },
    { label: 'Email', icon: Mail, action: () => { window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodedText}%0A%0A${encodedUrl}` } },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="marketplace-share-sheet">
        <DialogHeader>
          <DialogTitle>Share this vehicle</DialogTitle>
          <DialogDescription>Send the public CarUp listing directly, or copy the link.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {actions.map(({ label, icon: Icon, action }) => (
            <button
              key={label}
              type="button"
              onClick={action}
              className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm font-medium text-slate-800 transition hover:-translate-y-0.5 hover:border-orange-300 hover:bg-orange-50"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-white">
                <Icon className="h-4 w-4" />
              </span>
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
          <code className="min-w-0 flex-1 truncate px-2 text-xs text-slate-500">{url}</code>
          <Button type="button" size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <Button type="button" variant="ghost" onClick={nativeShare} className="w-full">
          <MoreHorizontal className="mr-2 h-4 w-4" /> More sharing options
        </Button>
      </DialogContent>
    </Dialog>
  )
}
